"""Заявки жильца арендодателю: ремонт, показания счётчиков, продление и выезд."""
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from core.audit import log_action
from finance.models import MeterReading as FinanceMeter
from leasing.models import Lease
from leasing.uploads import validate_media
from reminders.messages import t
from reminders.services import notify_owner_event

from .models import LeaseRequest, RepairRequest, TenantMeterReading, TenantNotification
from .push import send_push

MAX_OPEN_REPAIRS = 10

REPAIR_STATUS = {
    "ru": {"new": "принята", "in_progress": "в работе", "done": "решена", "rejected": "отклонена"},
    "uz": {"new": "qabul qilindi", "in_progress": "jarayonda", "done": "hal qilindi", "rejected": "rad etildi"},
}
REQUEST_STATUS = {
    "ru": {"accepted": "принята", "declined": "отклонена"},
    "uz": {"accepted": "qabul qilindi", "declined": "rad etildi"},
}
METER_LABEL = {
    "ru": {"electricity": "свет", "water_cold": "холодная вода", "water_hot": "горячая вода", "gas": "газ"},
    "uz": {"electricity": "elektr", "water_cold": "sovuq suv", "water_hot": "issiq suv", "gas": "gaz"},
}


def _active_lease(user, lease_id):
    lease = (Lease.objects.filter(pk=lease_id, tenant__user=user, hidden_by_tenant=False)
             .select_related("property", "tenant", "owner").first())
    if lease is None:
        raise NotFound()
    if lease.status != Lease.Status.ACTIVE:
        raise ValidationError({"detail": ["Договор завершён: действие недоступно."]})
    return lease


def _photo_fields(file):
    if file is None:
        return {}
    kind, content_type = validate_media(file)
    if kind != "photo":
        raise ValidationError({"photo": ["Прикрепите фото (JPG, PNG или WebP)."]})
    return {"photo": file, "photo_content_type": content_type}


def notify_tenant(lease, kind, *, title, text, url="/cabinet"):
    """Запись в ленте уведомлений кабинета + push жильцу."""
    user = lease.tenant.user
    if user is None:
        return
    TenantNotification.objects.create(user=user, lease=lease, kind=kind)
    send_push(user, title, text, url=url)


# ---------- хранение фото ----------

def purge_old_photos(now=None):
    """Фото живут REQUEST_PHOTO_KEEP_DAYS дней: файл удаляется из хранилища, сама заявка/показание остаются."""
    cutoff = (now or timezone.now()) - timedelta(days=settings.REQUEST_PHOTO_KEEP_DAYS)
    removed = 0
    # у показания отсчёт от последней отправки (её можно заменить в тот же месяц), у заявки — от создания
    for model, field in ((RepairRequest, "created_at"), (TenantMeterReading, "updated_at")):
        for item in model.objects.filter(**{f"{field}__lt": cutoff}).exclude(photo=""):
            name, storage = item.photo.name, item.photo.storage
            item.photo, item.photo_content_type = "", ""
            item.save(update_fields=["photo", "photo_content_type"])
            try:
                storage.delete(name)
            except OSError:
                pass  # файла уже нет — запись всё равно очищена
            removed += 1
    return removed


# ---------- ремонт ----------

@transaction.atomic
def create_repair(*, user, lease_id, title, description="", photo=None):
    lease = _active_lease(user, lease_id)
    open_count = lease.repair_requests.filter(status__in=("new", "in_progress")).count()
    if open_count >= MAX_OPEN_REPAIRS:
        raise ValidationError({"detail": ["Слишком много открытых заявок. Дождитесь ответа арендодателя."]})
    item = RepairRequest.objects.create(
        owner_id=lease.owner_id, lease=lease, title=title.strip(), description=description.strip(),
        **_photo_fields(photo),
    )
    log_action(lease.owner, "repair.created", item, actor=user, lease=lease.pk)
    owner = lease.owner
    transaction.on_commit(lambda: notify_owner_event(
        owner, title=lease.property.name, url="/requests", key=f"oe:repair:{item.pk}",
        text=t(owner.language, "owner_repair", tenant=lease.tenant.full_name, property=lease.property.name,
               title=item.title)))
    return item


@transaction.atomic
def update_repair(*, owner, actor, repair_id, status, comment=""):
    item = (RepairRequest.objects.select_for_update(of=("self",))
            .select_related("lease__property", "lease__tenant__user").filter(pk=repair_id, owner=owner).first())
    if item is None:
        raise NotFound()
    changed = status != item.status or comment != item.landlord_comment
    item.status, item.landlord_comment = status, comment[:255]
    item.resolved_at = timezone.now() if status in ("done", "rejected") else None
    item.save(update_fields=["status", "landlord_comment", "resolved_at", "updated_at"])
    log_action(owner, "repair.updated", item, actor=actor, status=status)
    if changed:
        lease = item.lease
        lang = lease.tenant.language
        text = t(lang, "tenant_repair", title=item.title, property=lease.property.name,
                 status=REPAIR_STATUS[lang][status])
        transaction.on_commit(lambda: notify_tenant(
            lease, TenantNotification.Kind.REPAIR_UPDATED, title=lease.property.name, text=text,
            url="/cabinet?tab=services"))
    return item


# ---------- счётчики ----------

@transaction.atomic
def submit_reading(*, user, lease_id, kind, value, photo=None):
    lease = _active_lease(user, lease_id)
    period = timezone.localdate().replace(day=1)
    previous = TenantMeterReading.objects.filter(lease=lease, kind=kind, period__lt=period).order_by("-period").first()
    if previous and value < previous.value:
        raise ValidationError({"value": [f"Показание не может быть меньше предыдущего ({previous.value})."]})
    fields = _photo_fields(photo)
    reading, _ = TenantMeterReading.objects.update_or_create(
        lease=lease, kind=kind, period=period,
        defaults={"owner_id": lease.owner_id, "value": value, **fields},
    )
    # то же показание — в учёте счётчиков арендодателя (по объекту и дате)
    FinanceMeter.objects.update_or_create(
        property=lease.property, meter=kind, reading_date=timezone.localdate(),
        defaults={"owner_id": lease.owner_id, "value": value, "note": f"От жильца: {lease.tenant.full_name}"[:255]},
    )
    log_action(lease.owner, "meter.submitted", reading, actor=user, lease=lease.pk, kind=kind, value=value)
    owner = lease.owner
    lang = owner.language
    transaction.on_commit(lambda: notify_owner_event(
        owner, title=lease.property.name, url="/requests", key=f"oe:meter:{reading.pk}:{value}",
        text=t(lang, "owner_meter", tenant=lease.tenant.full_name, property=lease.property.name,
               kind=METER_LABEL[lang][kind], value=value)))
    return reading


# ---------- продление / выезд ----------

@transaction.atomic
def create_lease_request(*, user, lease_id, kind, months=None, move_out_date=None, comment=""):
    lease = _active_lease(user, lease_id)
    if kind == LeaseRequest.Kind.EXTEND:
        if not months:
            raise ValidationError({"months": ["Укажите, на сколько месяцев продлить."]})
        move_out_date = None
    else:
        months = None
        if move_out_date is None or move_out_date < timezone.localdate():
            raise ValidationError({"move_out_date": ["Укажите дату выезда — сегодняшнюю или позже."]})
    try:
        with transaction.atomic():
            item = LeaseRequest.objects.create(
                owner_id=lease.owner_id, lease=lease, kind=kind, months=months, move_out_date=move_out_date,
                comment=comment.strip(),
            )
    except IntegrityError:
        raise ValidationError({"detail": ["У вас уже есть просьба, ожидающая ответа."]})
    log_action(lease.owner, "lease_request.created", item, actor=user, kind=kind)
    owner = lease.owner
    lang = owner.language
    if kind == LeaseRequest.Kind.EXTEND:
        text = t(lang, "owner_req_extend", tenant=lease.tenant.full_name, property=lease.property.name, months=months)
    else:
        text = t(lang, "owner_req_leave", tenant=lease.tenant.full_name, property=lease.property.name,
                 date=move_out_date.strftime("%d.%m.%Y"))
    transaction.on_commit(lambda: notify_owner_event(
        owner, title=lease.property.name, url="/requests", key=f"oe:lreq:{item.pk}", text=text))
    return item


@transaction.atomic
def cancel_lease_request(*, user, request_id):
    item = (LeaseRequest.objects.select_for_update(of=("self",))
            .filter(pk=request_id, lease__tenant__user=user, status="pending").first())
    if item is None:
        raise NotFound()
    item.status, item.resolved_at = LeaseRequest.Status.CANCELLED, timezone.now()
    item.save(update_fields=["status", "resolved_at", "updated_at"])
    return item


@transaction.atomic
def resolve_lease_request(*, owner, actor, request_id, accept, comment=""):
    item = (LeaseRequest.objects.select_for_update(of=("self",))
            .select_related("lease__property", "lease__tenant__user").filter(pk=request_id, owner=owner).first())
    if item is None:
        raise NotFound()
    if item.status != LeaseRequest.Status.PENDING:
        raise ValidationError({"detail": ["Просьба уже обработана."]})
    item.status = LeaseRequest.Status.ACCEPTED if accept else LeaseRequest.Status.DECLINED
    item.landlord_comment, item.resolved_at = comment[:255], timezone.now()
    item.save(update_fields=["status", "landlord_comment", "resolved_at", "updated_at"])
    log_action(owner, "lease_request.resolved", item, actor=actor, status=item.status)
    lease = item.lease
    lang = lease.tenant.language
    text = t(lang, "tenant_req", property=lease.property.name, status=REQUEST_STATUS[lang][item.status])
    transaction.on_commit(lambda: notify_tenant(
        lease, TenantNotification.Kind.REQUEST_RESOLVED, title=lease.property.name, text=text,
        url="/cabinet?tab=services"))
    return item
