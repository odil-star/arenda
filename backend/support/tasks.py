import logging

from celery import shared_task

from leasing.models import Tenant
from reminders.channels import SendError, get_sender

from .models import SupportMessage

logger = logging.getLogger(__name__)

TEXT = {
    "ru": "Ответ поддержки:\n\n{body}\n\nОткройте чат в личном кабинете, чтобы ответить.",
    "uz": "Qoʻllab-quvvatlash javobi:\n\n{body}\n\nJavob berish uchun shaxsiy kabinetdagi chatni oching.",
}


def _chat_id(user):
    if user.telegram_chat_id:
        return user.telegram_chat_id
    tenant = Tenant.objects.filter(user=user, telegram_chat_id__isnull=False).only("telegram_chat_id").first()
    return tenant.telegram_chat_id if tenant else None


@shared_task
def notify_support_reply(message_id):
    """Ответ поддержки — в Telegram пользователю, если он привязан. Иначе молча (он увидит в кабинете)."""
    message = SupportMessage.objects.select_related("thread__user").filter(pk=message_id, from_staff=True).first()
    if message is None:
        return False
    user = message.thread.user
    chat_id = _chat_id(user)
    if not chat_id:
        return False
    body = message.body if len(message.body) <= 1000 else message.body[:1000] + "…"
    text = TEXT.get(user.language, TEXT["ru"]).format(body=body)
    try:
        get_sender().send(chat_id, text)
    except SendError as exc:
        logger.warning("support: Telegram не доставлен (thread=%s): %s", message.thread_id, exc)
        return False
    return True
