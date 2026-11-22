from django.conf import settings
from django.db import models


class OwnedModel(models.Model):
    """База всех бизнес-таблиц: данные принадлежат одному владельцу (арендодателю)."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class AuditLog(models.Model):
    """Журнал критичных действий: кто, что, когда."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )  # пусто, если действие совершила система (вебхук, Celery)
    action = models.CharField(max_length=64)
    object_type = models.CharField(max_length=64, blank=True)
    object_id = models.BigIntegerField(null=True, blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self):
        return f"{self.action} #{self.object_id}"


class AdminMessage(models.Model):
    """Рассылка от администратора платформы арендодателям (история отправок)."""

    class Audience(models.TextChoices):
        ALL = "all", "Все арендодатели"
        SELECTED = "selected", "Выбранные"

    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    subject = models.CharField(max_length=200)
    body = models.TextField()
    audience = models.CharField(max_length=10, choices=Audience.choices)
    channels = models.JSONField(default=list)  # ["email", "telegram"]
    recipients_count = models.PositiveIntegerField(default=0)
    email_sent = models.PositiveIntegerField(default=0)
    telegram_sent = models.PositiveIntegerField(default=0)
    failed = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self):
        return self.subject


class WebhookLog(models.Model):
    """Каждый входящий запрос Payme/Click: что прислал провайдер и что ответил сервис.

    Секреты (подписи, пароли, ключи) в запрос не попадают — см. billing.webhook_log.
    """

    class Provider(models.TextChoices):
        PAYME = "payme", "Payme"
        CLICK = "click", "Click"

    provider = models.CharField(max_length=10, choices=Provider.choices, db_index=True)
    method = models.CharField(max_length=64, blank=True)  # Payme: имя метода; Click: prepare / complete
    ok = models.BooleanField(default=True, db_index=True)
    error_code = models.CharField(max_length=32, blank=True)
    payment_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    request = models.JSONField(default=dict, blank=True)
    response = models.JSONField(default=dict, blank=True)
    remote_addr = models.GenericIPAddressField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self):
        return f"{self.provider}:{self.method}"


class Announcement(models.Model):
    """Объявление админа: баннер в кабинете арендодателя и жильца, пока включено."""

    class Level(models.TextChoices):
        INFO = "info", "Информация"
        WARNING = "warning", "Важно"

    text_ru = models.CharField(max_length=500)
    text_uz = models.CharField(max_length=500, blank=True)  # пусто — показываем русский текст
    level = models.CharField(max_length=10, choices=Level.choices, default=Level.INFO)
    is_active = models.BooleanField(default=True, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self):
        return self.text_ru[:50]


class AdminNote(models.Model):
    """Внутренняя заметка сотрудника об арендодателе. Сам арендодатель её не видит."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    text = models.CharField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")


class Plan(models.Model):
    """Тариф. max_properties пусто — без ограничения по объектам."""

    name = models.CharField(max_length=100, unique=True)
    max_properties = models.PositiveIntegerField(null=True, blank=True)
    price = models.PositiveBigIntegerField("Цена в месяц, сум", default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("price", "id")

    def __str__(self):
        return self.name


class Subscription(models.Model):
    """Тариф арендодателя. Нет записи — ограничений нет (как раньше)."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subscription")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    paid_until = models.DateField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user_id}: {self.plan_id}"
