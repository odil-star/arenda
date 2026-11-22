from django.db import models

from core.models import OwnedModel


class NotificationLog(OwnedModel):
    """Запись о каждой отправке. Уникальный dedupe_key защищает от повторной отправки."""

    class Kind(models.TextChoices):
        TENANT_BEFORE = "tenant_before", "Арендатору: за N дней"
        TENANT_DUE = "tenant_due", "Арендатору: в день оплаты"
        TENANT_OVERDUE = "tenant_overdue", "Арендатору: просрочка"
        OWNER_SUMMARY = "owner_summary", "Владельцу: сводка"

    class Status(models.TextChoices):
        PENDING = "pending", "Отправляется"
        SENT = "sent", "Отправлено"
        FAILED = "failed", "Ошибка"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    payment = models.ForeignKey("leasing.Payment", null=True, blank=True, on_delete=models.SET_NULL,
                                related_name="notifications")
    tenant = models.ForeignKey("leasing.Tenant", null=True, blank=True, on_delete=models.SET_NULL,
                               related_name="notifications")
    dedupe_key = models.CharField(max_length=100, unique=True)
    chat_id = models.BigIntegerField()
    text = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    error = models.CharField(max_length=500, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at", "-id")
