"""Ежедневные напоминания: арендаторам — по каждому платежу, владельцам — одна сводка."""
import logging
from collections import defaultdict
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError
from django.db.models import F
from django.utils import timezone

from leasing.models import Lease, Payment

from portal.push import send_push

from .channels import get_sender
from .messages import money, t
from .models import NotificationLog

logger = logging.getLogger(__name__)


def tenant_kind(days_left):
    """Какое напоминание нужно арендатору сегодня (None — никакого)."""
    if days_left == settings.REMINDER_DAYS_BEFORE:
        return NotificationLog.Kind.TENANT_BEFORE
    if days_left == 0:
        return NotificationLog.Kind.TENANT_DUE
    if days_left < 0 and (-days_left - 1) % settings.REMINDER_OVERDUE_EVERY_DAYS == 0:
        return NotificationLog.Kind.TENANT_OVERDUE
    return None


def deliver(sender, *, owner, kind, dedupe_key, chat_id, text, payment=None, tenant=None):
    """Отправить сообщение не более одного раза на dedupe_key. Ошибочные пробуем снова."""
    try:
        log, created = NotificationLog.objects.get_or_create(
            dedupe_key=dedupe_key,
            defaults=dict(owner=owner, kind=kind, payment=payment, tenant=tenant, chat_id=chat_id, text=text),
        )
    except IntegrityError:  # параллельный воркер успел раньше
        return False
    if not created:
        # Повторяем только неудачные, и только если «захватили» запись первыми.
        claimed = NotificationLog.objects.filter(pk=log.pk, status=NotificationLog.Status.FAILED).update(
            status=NotificationLog.Status.PENDING
        )
        if not claimed:
            return False
    try:
        sender.send(chat_id, text)
    except Exception as exc:  # noqa: BLE001 — любая ошибка канала фиксируется в журнале
        NotificationLog.objects.filter(pk=log.pk).update(
            status=NotificationLog.Status.FAILED, error=str(exc)[:500]
        )
        logger.warning("Не удалось отправить напоминание %s: %s", dedupe_key, exc)
        return False
    NotificationLog.objects.filter(pk=log.pk).update(
        status=NotificationLog.Status.SENT, sent_at=timezone.now(), error=""
    )
    return True


def run_daily_reminders(today=None, sender=None):
    today = today or timezone.localdate()
    sender = sender or get_sender()
    horizon = today + timedelta(days=settings.REMINDER_DAYS_BEFORE)
    payments = (
        Payment.objects.filter(
            lease__status=Lease.Status.ACTIVE, amount_paid__lt=F("amount_due"), due_date__lte=horizon
        )
        .select_related("owner", "lease__property", "lease__tenant")
        .order_by("owner_id", "due_date")
    )
    stats = {"tenant_sent": 0, "owner_sent": 0}
    by_owner = defaultdict(list)
    for payment in payments:
        by_owner[payment.owner].append(payment)
        tenant = payment.lease.tenant
        days_left = (payment.due_date - today).days
        kind = tenant_kind(days_left)
        if kind is None:
            continue
        text = t(
            tenant.language, kind, days=abs(days_left), property=payment.lease.property.name,
            amount=money(payment.remaining), due=payment.due_date.strftime("%d.%m.%Y"),
        )
        send_push(
            tenant.user, payment.lease.property.name, text, url="/cabinet",
            dedupe_key=f"t:{payment.pk}:{kind}:{today.isoformat()}",
        )
        if tenant.telegram_chat_id is None:
            continue
        if deliver(
            sender, owner=payment.owner, kind=kind, payment=payment, tenant=tenant,
            dedupe_key=f"t:{payment.pk}:{kind}:{today.isoformat()}", chat_id=tenant.telegram_chat_id, text=text,
        ):
            stats["tenant_sent"] += 1
    for owner, items in by_owner.items():
        if owner.telegram_chat_id is None:
            continue
        text = owner_summary(owner, items, today)
        if deliver(
            sender, owner=owner, kind=NotificationLog.Kind.OWNER_SUMMARY, chat_id=owner.telegram_chat_id,
            dedupe_key=f"o:{owner.pk}:{today.isoformat()}", text=text,
        ):
            stats["owner_sent"] += 1
    return stats


def owner_summary(owner, payments, today):
    lang = owner.language
    overdue = [p for p in payments if p.due_date < today]
    due_today = [p for p in payments if p.due_date == today]
    soon = [p for p in payments if p.due_date > today]
    lines = [t(lang, "owner_header", date=today.strftime("%d.%m.%Y"))]
    for key, group in (("owner_overdue", overdue), ("owner_due", due_today), ("owner_soon", soon)):
        if group:
            lines.append(t(lang, key, count=len(group), amount=money(sum(p.remaining for p in group)),
                           days=settings.REMINDER_DAYS_BEFORE))
    for payment in (overdue + due_today + soon)[:15]:
        line = t(lang, "owner_line", tenant=payment.lease.tenant.full_name, property=payment.lease.property.name,
                 amount=money(payment.remaining), due=payment.due_date.strftime("%d.%m.%Y"))
        if payment.lease.tenant.telegram_chat_id is None:
            line += " " + t(lang, "owner_no_telegram")
        lines.append(line)
    return "\n".join(lines)


def notify_owner_receipt(receipt, sender=None):
    """Арендодателю в Telegram: жилец прислал чек. Сбой канала не должен ломать загрузку чека."""
    owner = receipt.owner
    payment = receipt.payment
    text = t(owner.language, "owner_receipt", tenant=payment.lease.tenant.full_name,
             property=payment.lease.property.name, amount=money(receipt.amount))
    send_push(owner, payment.lease.property.name, text, url="/receipts", dedupe_key=f"oe:receipt:{receipt.pk}")
    if owner.telegram_chat_id is None:
        return False
    try:
        return deliver(
            sender or get_sender(), owner=owner, kind=NotificationLog.Kind.OWNER_EVENT, payment=payment,
            dedupe_key=f"oe:receipt:{receipt.pk}", chat_id=owner.telegram_chat_id, text=text,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось уведомить владельца о чеке %s", receipt.pk)
        return False


def remind_tenants(owner, payment_ids, today=None, sender=None):
    """Ручное напоминание должникам. Не чаще одного раза в день на платёж."""
    today = today or timezone.localdate()
    sender = sender or get_sender()
    payments = Payment.objects.filter(
        owner=owner, pk__in=payment_ids, amount_paid__lt=F("amount_due")
    ).select_related("lease__property", "lease__tenant")
    stats = {"sent": 0, "no_telegram": 0, "already": 0, "failed": 0}
    for payment in payments:
        tenant = payment.lease.tenant
        text = t(tenant.language, "tenant_manual", property=payment.lease.property.name,
                 amount=money(payment.remaining), due=payment.due_date.strftime("%d.%m.%Y"))
        key = f"tm:{payment.pk}:{today.isoformat()}"
        pushed = send_push(tenant.user, payment.lease.property.name, text, url="/cabinet", dedupe_key=key)
        if tenant.telegram_chat_id is None:
            if pushed:
                stats["sent"] += 1
            else:
                stats["no_telegram"] += 1
            continue
        if deliver(sender, owner=owner, kind=NotificationLog.Kind.TENANT_MANUAL, payment=payment, tenant=tenant,
                   dedupe_key=key, chat_id=tenant.telegram_chat_id, text=text):
            stats["sent"] += 1
        elif NotificationLog.objects.filter(dedupe_key=key, status=NotificationLog.Status.SENT).exists():
            stats["already"] += 1
        else:
            stats["failed"] += 1
    return stats
