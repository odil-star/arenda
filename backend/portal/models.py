import builtins
import hashlib
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import OwnedModel


def hash_token(token):
    """sha256-хэш токена приглашения; сам токен нигде не хранится."""
    return hashlib.sha256(token.encode()).hexdigest()


def default_invite_expiry():
    return timezone.now() + timedelta(days=7)


def default_otp_expiry():
    return timezone.now() + timedelta(minutes=5)


class Invite(models.Model):
    """Одноразовое приглашение для конкретного жильца (Tenant)."""

    tenant = models.ForeignKey("leasing.Tenant", on_delete=models.CASCADE, related_name="invites")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    # Если приглашение создано от объекта — какой именно (для превью и «жилец без договора»)
    property = models.ForeignKey("leasing.Property", null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name="+")
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField(default=default_invite_expiry)
    used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")

    @builtins.property  # имя `property` в классе занято полем
    def is_active(self):
        return self.used_at is None and self.revoked_at is None and self.expires_at > timezone.now()

    def __str__(self):
        return f"Invite #{self.pk} tenant={self.tenant_id}"


class PhoneOTP(models.Model):
    """Одноразовый SMS-код. Хранится только HMAC-хэш; после 5 неверных попыток код блокируется."""

    MAX_ATTEMPTS = 5

    phone = models.CharField(max_length=32, db_index=True)
    code_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField(default=default_otp_expiry)
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")


def receipt_upload_to(instance, filename):
    import uuid
    from pathlib import Path

    return f"receipts/{instance.owner_id}/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


class PaymentReceipt(OwnedModel):
    """Чек об оплате от жильца. Деньги зачисляются, только когда арендодатель подтвердит."""

    class Status(models.TextChoices):
        PENDING = "pending", "На проверке"
        CONFIRMED = "confirmed", "Подтверждён"
        REJECTED = "rejected", "Отклонён"

    payment = models.ForeignKey("leasing.Payment", on_delete=models.CASCADE, related_name="receipts")
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL,
                                     related_name="+")
    file = models.FileField(upload_to=receipt_upload_to, max_length=255)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()
    amount = models.PositiveBigIntegerField("Заявленная сумма, сум")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    reject_reason = models.CharField(max_length=255, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="receipt_amount_positive"),
            # у платежа не больше одного чека «на проверке»
            models.UniqueConstraint(fields=["payment"], condition=models.Q(status="pending"),
                                    name="receipt_one_pending_per_payment"),
        ]


def lease_media_upload_to(instance, filename):
    import uuid
    from pathlib import Path

    return f"lease_media/{instance.owner_id}/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


class LeaseMedia(OwnedModel):
    """Фото и видео состояния квартиры, прикреплённые к договору."""

    class Kind(models.TextChoices):
        PHOTO = "photo", "Фото"
        VIDEO = "video", "Видео"

    lease = models.ForeignKey("leasing.Lease", on_delete=models.CASCADE, related_name="media")
    kind = models.CharField(max_length=5, choices=Kind.choices)
    file = models.FileField(upload_to=lease_media_upload_to, max_length=255)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveBigIntegerField()

    class Meta:
        ordering = ("created_at", "id")
        verbose_name_plural = "lease media"


class TenantNotification(models.Model):
    """Уведомление жильцу в кабинете (текст формирует клиент по kind и count)."""

    class Kind(models.TextChoices):
        MEDIA_ADDED = "media_added", "Добавлены фото/видео"
        MEDIA_CHANGED = "media_changed", "Изменены фото/видео"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tenant_notifications")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    lease = models.ForeignKey("leasing.Lease", null=True, on_delete=models.CASCADE, related_name="+")
    count = models.PositiveIntegerField(default=1)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [models.Index(fields=["user", "read_at"])]
