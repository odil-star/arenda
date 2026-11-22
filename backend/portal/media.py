"""Фото и видео состояния квартиры: арендодатель добавляет/меняет, жилец получает уведомление."""
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.audit import log_action
from leasing.uploads import validate_media

from .models import LeaseMedia, TenantNotification

MERGE_WINDOW = timedelta(minutes=30)


def notify_tenant(lease, kind, count=1):
    """Одно уведомление на серию загрузок: пока прошлое не прочитано, считаем в него."""
    user_id = lease.tenant.user_id
    if user_id is None:
        return None
    recent = (
        TenantNotification.objects.select_for_update()
        .filter(user_id=user_id, lease=lease, kind=kind, read_at__isnull=True,
                created_at__gte=timezone.now() - MERGE_WINDOW).first()
    )
    if recent:
        recent.count += count
        recent.save(update_fields=["count"])
        return recent
    return TenantNotification.objects.create(user_id=user_id, lease=lease, kind=kind, count=count)


def _fill(file):
    kind, content_type = validate_media(file)
    return {
        "kind": kind, "content_type": content_type, "size": file.size, "file": file,
        "original_name": file.name.replace("\\", "/").rsplit("/", 1)[-1][:255],
    }


@transaction.atomic
def add_media(*, lease, actor, file, notify=True):
    if lease.media.count() >= settings.LEASE_MEDIA_MAX_FILES:
        raise ValidationError({"file": [f"К договору можно прикрепить не больше {settings.LEASE_MEDIA_MAX_FILES} файлов."]})
    media = LeaseMedia.objects.create(owner_id=lease.owner_id, lease=lease, **_fill(file))
    log_action(lease.owner, "lease_media.added", media, actor=actor, lease=lease.pk, name=media.original_name)
    if notify:
        notify_tenant(lease, TenantNotification.Kind.MEDIA_ADDED)
    return media


@transaction.atomic
def replace_media(*, media, actor, file):
    old_storage, old_name = media.file.storage, media.file.name
    fields = _fill(file)
    for name, value in fields.items():
        setattr(media, name, value)
    media.save()
    transaction.on_commit(lambda: old_storage.delete(old_name))
    log_action(media.owner, "lease_media.replaced", media, actor=actor, lease=media.lease_id)
    notify_tenant(media.lease, TenantNotification.Kind.MEDIA_CHANGED)
    return media


@transaction.atomic
def delete_media(*, media, actor):
    storage, name = media.file.storage, media.file.name
    lease = media.lease
    log_action(media.owner, "lease_media.deleted", media, actor=actor, lease=lease.pk, name=media.original_name)
    media.delete()
    transaction.on_commit(lambda: storage.delete(name))
    notify_tenant(lease, TenantNotification.Kind.MEDIA_CHANGED)
