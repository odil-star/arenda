"""Чеки об оплате: жилец отправляет скриншот, арендодатель подтверждает или отклоняет."""
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.audit import log_action
from leasing import services as lease_services
from leasing.models import Payment
from leasing.uploads import validate_upload

from .models import PaymentReceipt


def month_reached(payment, today=None):
    """Оплатить можно, когда наступил месяц платежа (или он уже просрочен)."""
    today = today or timezone.localdate()
    return payment.due_date.replace(day=1) <= today.replace(day=1)


def latest_receipt(payment):
    receipts = list(payment.receipts.all())  # prefetch
    return max(receipts, key=lambda r: (r.created_at, r.pk)) if receipts else None


def can_pay(payment):
    last = latest_receipt(payment)
    return payment.remaining > 0 and month_reached(payment) and not (last and last.status == "pending")


@transaction.atomic
def submit_receipt(*, user, payment_id, file, amount=None):
    payment = (
        Payment.objects.select_for_update(of=("self",))
        .select_related("owner").filter(pk=payment_id, lease__tenant__user=user).first()
    )
    if payment is None:
        raise Payment.DoesNotExist
    if payment.remaining <= 0:
        raise ValidationError({"detail": ["Этот платёж уже оплачен."]})
    if not month_reached(payment):
        raise ValidationError({"detail": ["Оплата откроется, когда наступит месяц платежа."]})
    if payment.receipts.filter(status=PaymentReceipt.Status.PENDING).exists():
        raise ValidationError({"detail": ["Чек по этому платежу уже отправлен и ждёт проверки."]})
    amount = payment.remaining if amount is None else amount
    if not 0 < amount <= payment.remaining:
        raise ValidationError({"amount": ["Сумма должна быть от 1 до остатка по платежу."]})
    content_type = validate_upload(file, "document")  # PDF / JPG / PNG, по содержимому
    receipt = PaymentReceipt.objects.create(
        owner_id=payment.owner_id, payment=payment, submitted_by=user, file=file,
        original_name=file.name.replace("\\", "/").rsplit("/", 1)[-1][:255],
        content_type=content_type, size=file.size, amount=amount,
    )
    log_action(payment.owner, "receipt.submitted", receipt, actor=user, payment=payment.pk, amount=amount)
    return receipt


@transaction.atomic
def confirm_receipt(*, receipt_id, owner, actor, amount=None):
    receipt = PaymentReceipt.objects.select_for_update().get(pk=receipt_id, owner=owner)
    if receipt.status != PaymentReceipt.Status.PENDING:
        raise ValidationError({"detail": ["Чек уже обработан."]})
    amount = receipt.amount if amount is None else amount
    try:
        lease_services.apply_payment(
            payment_id=receipt.payment_id, amount=amount, provider="manual",
            external_id=f"receipt:{receipt.pk}", owner=owner, actor=actor,
        )
    except lease_services.PaymentError as exc:
        raise ValidationError({"amount": [exc.message]})
    receipt.amount, receipt.status = amount, PaymentReceipt.Status.CONFIRMED
    receipt.reviewed_at = timezone.now()
    receipt.save(update_fields=["amount", "status", "reviewed_at", "updated_at"])
    log_action(owner, "receipt.confirmed", receipt, actor=actor, payment=receipt.payment_id, amount=amount)
    return receipt


@transaction.atomic
def reject_receipt(*, receipt_id, owner, actor, reason=""):
    receipt = PaymentReceipt.objects.select_for_update().get(pk=receipt_id, owner=owner)
    if receipt.status != PaymentReceipt.Status.PENDING:
        raise ValidationError({"detail": ["Чек уже обработан."]})
    receipt.status, receipt.reject_reason = PaymentReceipt.Status.REJECTED, reason[:255]
    receipt.reviewed_at = timezone.now()
    receipt.save(update_fields=["status", "reject_reason", "reviewed_at", "updated_at"])
    log_action(owner, "receipt.rejected", receipt, actor=actor, payment=receipt.payment_id)
    return receipt
