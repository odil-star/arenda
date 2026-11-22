"""Бизнес-логика: график платежей, оплата, продление и завершение договора."""
import calendar
import uuid
from datetime import date

from django.db import IntegrityError, transaction
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.audit import log_action

from .models import Lease, Payment, PaymentTransaction


class PaymentError(Exception):
    """Ошибка проведения платежа с кодом — провайдерам нужно отличать причины."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------- график платежей ----------

def _next_month(year, month):
    return (year + 1, 1) if month == 12 else (year, month + 1)


def iter_due_dates(start_date, end_date, payment_day):
    """Даты оплаты: каждое `payment_day`-е число, начиная со start_date и строго до end_date.

    payment_day <= 28, поэтому число существует в любом месяце (в том числе в феврале
    високосного года). Если договор начался после payment_day, первая оплата — в следующем месяце.
    """
    year, month = start_date.year, start_date.month
    current = date(year, month, payment_day)
    if current < start_date:
        year, month = _next_month(year, month)
        current = date(year, month, payment_day)
    while current < end_date:
        yield current
        year, month = _next_month(year, month)
        current = date(year, month, payment_day)


def generate_schedule(lease):
    """Создать недостающие платежи договора. Безопасно вызывать повторно.

    Возвращает число реально созданных платежей.
    """
    wanted = [
        Payment(
            owner_id=lease.owner_id, lease=lease, due_date=due, amount_due=lease.rent_amount
        )
        for due in iter_due_dates(lease.start_date, lease.end_date, lease.payment_day)
    ]
    before = Payment.objects.filter(lease=lease).count()
    Payment.objects.bulk_create(wanted, ignore_conflicts=True)
    return Payment.objects.filter(lease=lease).count() - before


# ---------- договоры ----------

def create_lease(*, owner, actor, **fields):
    """Договор и график платежей создаются в одной транзакции."""
    try:
        with transaction.atomic():
            lease = Lease.objects.create(owner=owner, **fields)
            created = generate_schedule(lease)
            log_action(owner, "lease.created", lease, actor=actor, payments_created=created)
    except IntegrityError:
        # Только настоящий конфликт «второй действующий договор» — иначе это другая ошибка БД,
        # и прятать её за дружелюбным текстом нельзя (поднимется как 500 и попадёт в лог).
        if Lease.objects.filter(property=fields["property"], status=Lease.Status.ACTIVE).exists():
            raise ValidationError({"property": ["На этот объект уже есть действующий договор."]})
        raise
    return lease


def _locked_lease(lease_id, owner):
    try:
        return Lease.objects.select_for_update().get(pk=lease_id, owner=owner)
    except Lease.DoesNotExist:
        raise Http404


@transaction.atomic
def end_lease(*, lease_id, owner, actor):
    lease = _locked_lease(lease_id, owner)
    if lease.status != Lease.Status.ACTIVE:
        raise ValidationError({"status": ["Договор уже завершён."]})
    lease.status = Lease.Status.ENDED
    lease.save(update_fields=["status", "updated_at"])
    # Будущие неоплаченные платежи без попыток оплаты больше не нужны.
    removed, _ = (
        Payment.objects.filter(
            lease=lease, due_date__gt=timezone.localdate(), amount_paid=0, transactions__isnull=True
        ).delete()
    )
    log_action(owner, "lease.ended", lease, actor=actor, future_payments_removed=removed)
    return lease


@transaction.atomic
def extend_lease(*, lease_id, owner, actor, new_end_date):
    lease = _locked_lease(lease_id, owner)
    if lease.status != Lease.Status.ACTIVE:
        raise ValidationError({"status": ["Нельзя продлить завершённый договор."]})
    if new_end_date <= lease.end_date:
        raise ValidationError({"end_date": ["Новая дата окончания должна быть позже текущей."]})
    old_end = lease.end_date
    lease.end_date = new_end_date
    lease.save(update_fields=["end_date", "updated_at"])
    created = generate_schedule(lease)
    log_action(
        owner, "lease.extended", lease, actor=actor,
        old_end_date=old_end.isoformat(), new_end_date=new_end_date.isoformat(), payments_created=created,
    )
    return lease, created


# ---------- платежи ----------

def lock_payment(payment_id, owner=None):
    """Заблокировать платёж на время транзакции (вызывать внутри transaction.atomic)."""
    qs = Payment.objects.select_for_update()
    if owner is not None:
        qs = qs.filter(owner=owner)
    try:
        return qs.get(pk=payment_id)
    except Payment.DoesNotExist:
        raise Http404


def credit_payment(payment, amount):
    payment.amount_paid += amount
    payment.paid_at = timezone.now()
    payment.save(update_fields=["amount_paid", "paid_at", "updated_at"])


def revert_payment(payment, amount):
    payment.amount_paid -= amount
    if payment.amount_paid == 0:
        payment.paid_at = None
    payment.save(update_fields=["amount_paid", "paid_at", "updated_at"])


def check_amount(payment, amount):
    if amount <= 0:
        raise PaymentError("amount", "Сумма должна быть больше нуля.")
    if amount > payment.remaining:
        raise PaymentError("amount", "Сумма превышает остаток по платежу.")


@transaction.atomic
def apply_payment(*, payment_id, amount, provider, external_id, owner=None, actor=None):
    """Зачесть оплату. Идемпотентно по (provider, external_id).

    Возвращает (транзакция, created). Повторный вызов с тем же ключом ничего не меняет.
    """
    payment = lock_payment(payment_id, owner)  # блокировка ДО проверки дубля — иначе гонка
    existing = PaymentTransaction.objects.filter(provider=provider, external_id=external_id).first()
    if existing is not None:
        if existing.payment_id != payment.id or existing.amount != amount:
            raise PaymentError("conflict", "Этот ключ идемпотентности уже использован для другой оплаты.")
        return existing, False
    check_amount(payment, amount)
    now = timezone.now()
    tx = PaymentTransaction.objects.create(
        owner_id=payment.owner_id, payment=payment, provider=provider, external_id=external_id,
        amount=amount, state=PaymentTransaction.State.COMPLETED, performed_at=now,
    )
    credit_payment(payment, amount)
    log_action(
        payment.owner, "payment.paid", payment, actor=actor,
        amount=amount, provider=provider, transaction_id=tx.id,
    )
    return tx, True


def new_manual_key():
    return uuid.uuid4().hex
