"""Фоновые задачи платформы: оповещение админов о проблемных оплатах и чистка журнала вебхуков."""
import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail
from django.db.models import Q
from django.utils import timezone

from leasing.models import PaymentTransaction
from users.models import User

from .audit import log_action
from .integrations import DeliveryError, post_event, record_result
from .models import AuditLog, Webhook, WebhookLog

logger = logging.getLogger(__name__)

ALERT_ACTION = "admin_alert_problem_payments"
ALERT_COOLDOWN = timedelta(hours=12)  # повторно о том же не пишем
WEBHOOK_LOG_KEEP = timedelta(days=60)


def recent_problem_count(now=None):
    """Проблемные оплаты: отменённые/возвращённые за последние сутки + зависшие (созданы >1 суток назад)."""
    now = now or timezone.now()
    State = PaymentTransaction.State
    return PaymentTransaction.objects.filter(
        Q(state__in=[State.CANCELLED, State.REFUNDED], updated_at__gte=now - timedelta(hours=24))
        | Q(state=State.CREATED, created_at__lt=now - timedelta(days=1))
    ).count()


@shared_task
def check_problem_payments():
    """Если проблемных оплат не меньше порога — пишем всем активным админам (раз в 12 часов).

    Возвращает число оповещённых админов.
    """
    now = timezone.now()
    count = recent_problem_count(now)
    threshold = settings.ADMIN_ALERT_PROBLEM_THRESHOLD
    if threshold <= 0 or count < threshold:
        return 0
    if AuditLog.objects.filter(action=ALERT_ACTION, created_at__gte=now - ALERT_COOLDOWN).exists():
        return 0

    subject = f"Проблемные оплаты: {count}"
    body = (
        f"За последние сутки проблемных оплат: {count} (порог {threshold}).\n"
        "Откройте админ-раздел → «Оплаты» → «Только проблемные» и проверьте журнал вебхуков."
    )
    notified = 0
    sender = None
    for admin in User.objects.filter(is_superuser=True, is_active=True):
        try:
            send_mail(subject, body, None, [admin.email])
        except Exception:  # noqa: BLE001
            logger.exception("Оповещение админа %s не отправлено по email", admin.pk)
        if admin.telegram_chat_id:
            try:
                from reminders.channels import SendError, get_sender

                sender = sender or get_sender()
                sender.send(admin.telegram_chat_id, f"{subject}\n\n{body}")
            except SendError:
                logger.warning("Оповещение админа %s не отправлено в Telegram", admin.pk)
        log_action(admin, ALERT_ACTION, actor=None, count=count, threshold=threshold)
        notified += 1
    return notified


@shared_task
def prune_webhook_logs():
    """Журнал вебхуков хранится 60 дней."""
    deleted, _ = WebhookLog.objects.filter(created_at__lt=timezone.now() - WEBHOOK_LOG_KEEP).delete()
    return deleted


@shared_task(
    autoretry_for=(DeliveryError,), retry_backoff=30, retry_backoff_max=3600, max_retries=5, retry_jitter=True,
)
def deliver_webhook(webhook_id, event, event_id, data):
    """Доставка одного события; при сбое — повторы с растущей паузой (тот же event_id, чтобы получатель мог отсеять дубль)."""
    hook = Webhook.objects.filter(pk=webhook_id, is_active=True).first()
    if hook is None:
        return "skipped"
    try:
        status = post_event(hook.url, hook.secret, event, event_id, data)
    except DeliveryError as exc:
        record_result(hook, ok=False, error=str(exc))
        raise
    record_result(hook, ok=True, status=status)
    return status
