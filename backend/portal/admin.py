from django.contrib import admin

from .models import Invite


@admin.register(Invite)
class InviteAdmin(admin.ModelAdmin):
    list_display = ("id", "tenant", "created_by", "expires_at", "used_at", "revoked_at")
    readonly_fields = [f.name for f in Invite._meta.fields]

    def has_add_permission(self, request):
        return False
