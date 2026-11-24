from celery import shared_task
from django.db import transaction
from django.utils import timezone

from core.audit import log_action

from .models import Lease, SavedSearch


@shared_task
def end_expired_leases():
    """Договоры, срок которых вышел, переводятся в «завершён» (освобождая объект)."""
    today = timezone.localdate()
    ended = 0
    for lease_id in Lease.objects.filter(status=Lease.Status.ACTIVE, end_date__lt=today).values_list("id", flat=True):
        with transaction.atomic():
            lease = Lease.objects.select_for_update().get(pk=lease_id)
            if lease.status != Lease.Status.ACTIVE or lease.end_date >= today:
                continue
            lease.status = Lease.Status.ENDED
            lease.save(update_fields=["status", "updated_at"])
            log_action(lease.owner, "lease.expired", lease, actor=None)
            ended += 1
    return ended


MAX_NOTIFY_ITEMS = 5


@shared_task
def notify_saved_searches():
    """Шлёт в Telegram новые объявления по сохранённым поискам (то, чего ещё нет в seen_ids)."""
    from django.conf import settings

    from reminders.channels import SendError, get_sender
    from reminders.messages import money, t

    from .listings import apply_filters, available_properties

    sender, sent = get_sender(), 0
    for search in SavedSearch.objects.filter(is_active=True, chat_id__isnull=False):
        found = list(apply_filters(available_properties(), search.filters).order_by("-updated_at", "-id")[:200])
        seen = set(search.seen_ids)
        fresh = [p for p in found if p.pk not in seen]
        if not fresh:
            continue
        lines = [t(search.language, "search_new", count=len(fresh))]
        for prop in fresh[:MAX_NOTIFY_ITEMS]:
            lines.append(f"• {prop.name} — {money(prop.listing_price)} сум\n{settings.FRONTEND_URL}/listings/{prop.pk}")
        if len(fresh) > MAX_NOTIFY_ITEMS:
            lines.append(t(search.language, "search_more", count=len(fresh) - MAX_NOTIFY_ITEMS))
        try:
            sender.send(search.chat_id, "\n".join(lines))
        except SendError:
            continue  # попробуем в следующий раз; seen_ids не трогаем
        search.seen_ids = sorted(seen | {p.pk for p in found})
        search.save(update_fields=["seen_ids"])
        sent += 1
    return sent
