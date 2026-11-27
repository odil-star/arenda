"""Фоновые задачи кабинета жильца."""
from celery import shared_task

from .tenant_requests import purge_old_photos


@shared_task
def purge_request_photos():
    """Удаляет фото заявок на ремонт и показаний счётчиков старше REQUEST_PHOTO_KEEP_DAYS (по умолчанию 3 дня)."""
    return purge_old_photos()


# Через сколько часов без ответа арендодателю напоминают о заявке жильца: на VIP — быстрее, чем на Prime
NUDGE_HOURS = {"prime": 48, "vip": 24}


@shared_task
def nudge_stale_repairs():
    """Prime/VIP: если заявка жильца на ремонт висит «новой» дольше срока, арендодателю приходит напоминание (один раз на заявку)."""
    from datetime import timedelta

    from django.utils import timezone

    from core.tiers import owner_ids_with_tier
    from reminders.messages import t
    from reminders.services import notify_owner_event

    from .models import RepairRequest

    vip = owner_ids_with_tier("vip")
    prime = owner_ids_with_tier("prime") - vip
    now = timezone.now()
    sent = 0
    for owners, hours in ((vip, NUDGE_HOURS["vip"]), (prime, NUDGE_HOURS["prime"])):
        stale = RepairRequest.objects.filter(
            owner__in=owners, status=RepairRequest.Status.NEW, created_at__lt=now - timedelta(hours=hours),
        ).select_related("owner", "lease__property", "lease__tenant")
        for item in stale:
            text = t(item.owner.language, "owner_repair_nudge", hours=hours, tenant=item.lease.tenant.full_name,
                     property=item.lease.property.name, title=item.title)
            notify_owner_event(item.owner, title=item.lease.property.name, text=text, url="/requests",
                               key=f"repair-nudge:{item.pk}")
            sent += 1
    return sent
