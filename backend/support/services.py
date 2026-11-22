"""Логика чата: отправка, прочтение, счётчики. Вьюхи только проверяют права и формат."""
import logging

from django.db import transaction
from datetime import timedelta

from django.db.models import Max, Q
from django.utils import timezone

from .models import SupportMessage, SupportThread

logger = logging.getLogger(__name__)

PAGE = 50


def thread_for(user, create=False):
    if create:
        thread, _ = SupportThread.objects.get_or_create(user=user)
        return thread
    return SupportThread.objects.filter(user=user).first()


@transaction.atomic
def post_message(thread, author, body, from_staff):
    """Новое сообщение. Своё сообщение сразу считается прочитанным автором.

    Сообщение пользователя переоткрывает закрытый диалог.
    """
    thread = SupportThread.objects.select_for_update().get(pk=thread.pk)
    message = SupportMessage.objects.create(thread=thread, author=author, from_staff=from_staff, body=body)
    thread.last_message_at = message.created_at
    fields = ["last_message_at"]
    if from_staff:
        thread.staff_last_read_id = message.id
        fields.append("staff_last_read_id")
    else:
        thread.user_last_read_id = message.id
        fields.append("user_last_read_id")
        if thread.status == SupportThread.Status.CLOSED:
            thread.status = SupportThread.Status.OPEN
            thread.closed_at = None
            fields += ["status", "closed_at"]
    thread.save(update_fields=fields)
    if from_staff:
        transaction.on_commit(lambda: _notify_user(message.id))
    return message


def _notify_user(message_id):
    from .tasks import notify_support_reply

    try:
        notify_support_reply.delay(message_id)
    except Exception:  # noqa: BLE001 — уведомление не должно ломать ответ
        logger.exception("support: не удалось поставить уведомление в очередь")


def mark_read(thread, by_staff):
    """Отметить прочитанным всё, что есть в диалоге сейчас."""
    last = thread.messages.aggregate(m=Max("id"))["m"] or 0
    field = "staff_last_read_id" if by_staff else "user_last_read_id"
    # только вперёд: параллельный запрос со старым значением не откатит отметку
    SupportThread.objects.filter(pk=thread.pk, **{f"{field}__lt": last}).update(**{field: last})
    return last


def unread_for_user(thread):
    if thread is None:
        return 0
    return thread.messages.filter(from_staff=True, id__gt=thread.user_last_read_id).count()


def page(qs, after=None, before=None):
    """Сообщения по курсору id: after — новые (для опроса), before — более старые, иначе — последние."""
    if after is not None:
        rows = list(qs.filter(id__gt=after).order_by("id")[: PAGE * 2])
        return rows, False
    if before is not None:
        qs = qs.filter(id__lt=before)
    rows = list(qs.order_by("-id")[: PAGE + 1])
    has_more = len(rows) > PAGE
    return list(reversed(rows[:PAGE])), has_more


def set_status(thread, status):
    closed = status == SupportThread.Status.CLOSED
    closed_at = timezone.now() if closed else None
    SupportThread.objects.filter(pk=thread.pk).update(status=status, closed_at=closed_at)
    thread.status, thread.closed_at = status, closed_at
    return thread


def day_start(now=None):
    """Начало текущих суток по времени проекта (00:00 после 23:59 — счётчики дня обнуляются)."""
    return timezone.localtime(now or timezone.now()).replace(hour=0, minute=0, second=0, microsecond=0)


def admin_stats(threads):
    """Счётчики для шапки чата. `threads` — queryset диалогов с аннотацией `last_from_staff`.

    to_answer — открытые диалоги, где последнее слово за пользователем (текущее состояние, не сбрасывается);
    closed_today — закрытые за сегодняшние сутки (обнуляется в полночь).
    """
    start = day_start()
    return {
        "to_answer": threads.filter(status=SupportThread.Status.OPEN, last_from_staff=False).count(),
        "closed_today": threads.filter(status=SupportThread.Status.CLOSED, closed_at__gte=start).count(),
        "day_start": start,
        "day_end": start + timedelta(days=1),
    }


# --- статус сотрудников («в сети») -------------------------------------------------------------

ONLINE_TTL = timedelta(minutes=10)


def presence_for(user):
    from .models import StaffPresence

    presence, _ = StaffPresence.objects.get_or_create(user=user)
    return presence


def is_online(presence, now=None):
    now = now or timezone.now()
    return presence.status == presence.Status.ONLINE and bool(presence.last_seen) and presence.last_seen >= now - ONLINE_TTL


def staff_online(now=None):
    """Есть ли сейчас хоть один активный сотрудник «в сети» (имён пользователю не раскрываем)."""
    from .models import StaffPresence

    now = now or timezone.now()
    return StaffPresence.objects.filter(
        status=StaffPresence.Status.ONLINE, last_seen__gte=now - ONLINE_TTL, user__is_active=True,
    ).filter(Q(user__is_staff=True) | Q(user__is_superuser=True)).exists()
