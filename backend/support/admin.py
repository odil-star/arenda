from django.contrib import admin

from .models import SupportMessage, SupportThread


class MessageInline(admin.TabularInline):
    model = SupportMessage
    extra = 0
    fields = ("created_at", "from_staff", "author", "body")
    readonly_fields = ("created_at", "author")


@admin.register(SupportThread)
class SupportThreadAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "status", "last_message_at")
    list_filter = ("status",)
    search_fields = ("user__email", "user__phone")
    raw_id_fields = ("user",)
    inlines = [MessageInline]
