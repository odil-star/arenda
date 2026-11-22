"""Чат пользователя (арендодателя или жильца) с поддержкой платформы.

У каждого пользователя один диалог. Отвечает любой сотрудник платформы (администратор или
«поддержка»). Прочитанность хранится как id последнего прочитанного сообщения у каждой стороны —
непрочитанные = сообщения другой стороны с id больше этого значения.
"""
from django.conf import settings
from django.db import models

MAX_BODY = 2000


class SupportThread(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Открыт"
        CLOSED = "closed", "Закрыт"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="support_thread")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN, db_index=True)
    user_last_read_id = models.BigIntegerField(default=0)
    staff_last_read_id = models.BigIntegerField(default=0)
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)
    closed_at = models.DateTimeField(null=True, blank=True, db_index=True)  # когда закрыли в последний раз
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-last_message_at", "-id")

    def __str__(self):
        return f"support #{self.pk} ({self.user_id})"


class SupportMessage(models.Model):
    thread = models.ForeignKey(SupportThread, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )  # пусто — автор удалён (сотрудник отозван)
    from_staff = models.BooleanField(default=False)
    body = models.TextField(max_length=MAX_BODY)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("id",)
        indexes = [models.Index(fields=("thread", "id"))]

    def __str__(self):
        return self.body[:50]


class StaffPresence(models.Model):
    """Статус сотрудника в чате: сам ставит «в сети» / «не в сети».

    «В сети» считается, только пока админка открыта (last_seen обновляется раз в минуту) —
    если сотрудник закрыл вкладку и забыл переключить статус, через ONLINE_TTL он перестаёт считаться в сети.
    """

    class Status(models.TextChoices):
        ONLINE = "online", "В сети"
        OFFLINE = "offline", "Не в сети"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="support_presence")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OFFLINE)
    last_seen = models.DateTimeField(null=True, blank=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user_id}: {self.status}"
