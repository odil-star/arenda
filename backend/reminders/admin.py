from django.contrib import admin

from .models import NotificationLog


@admin.register(NotificationLog)
class NotificationLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "kind", "status", "chat_id", "owner")
    list_filter = ("kind", "status")
