from django.contrib import admin

from .models import Lease, Payment, PaymentTransaction, Property, Tenant


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ("name", "address", "kind", "is_under_repair", "owner")
    list_filter = ("kind", "is_under_repair")
    search_fields = ("name", "address")


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("full_name", "phone", "owner")
    search_fields = ("full_name", "phone")
    exclude = ("link_code",)


@admin.register(Lease)
class LeaseAdmin(admin.ModelAdmin):
    list_display = ("property", "tenant", "start_date", "end_date", "rent_amount", "status")
    list_filter = ("status",)


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("lease", "due_date", "amount_due", "amount_paid")
    list_filter = ("due_date",)


@admin.register(PaymentTransaction)
class PaymentTransactionAdmin(admin.ModelAdmin):
    list_display = ("payment", "provider", "external_id", "amount", "state", "created_at")
    list_filter = ("provider", "state")
