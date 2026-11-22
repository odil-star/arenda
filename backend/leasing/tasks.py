from celery import shared_task
from django.db import transaction
from django.utils import timezone

from core.audit import log_action

from .models import Lease


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
