from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User, UserProfile


class ProfileInline(admin.StackedInline):
    model = UserProfile
    can_delete = False


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    inlines = [ProfileInline]
    ordering = ("email",)
    list_display = ("email", "first_name", "last_name", "is_staff")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Профиль", {"fields": ("first_name", "last_name", "phone", "passport_data")}),
        ("Права", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),)
    search_fields = ("email", "first_name", "last_name")
