from decimal import Decimal

from rest_framework import serializers

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone

from core.mixins import OwnedPrimaryKeyRelatedField
from core.phone import normalize_phone

from .models import Lease, Payment, Property, Tenant


class PropertySerializer(serializers.ModelSerializer):
    area_m2 = serializers.DecimalField(
        max_digits=8, decimal_places=2, required=False, allow_null=True, min_value=Decimal("0.01")
    )

    class Meta:
        model = Property
        fields = ("id", "name", "address", "kind", "area_m2", "is_under_repair", "notes",
                  "is_listed", "listing_price", "listing_description", "rooms", "contact_phone", "has_telegram",
                  "floor", "floors_total", "renovation", "furniture", "amenities",
                  "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")
        extra_kwargs = {
            "listing_price": {"min_value": 1},
            "rooms": {"min_value": 1, "max_value": 50},
            "floor": {"min_value": 0, "max_value": 200},
            "floors_total": {"min_value": 1, "max_value": 200},
            "listing_description": {"max_length": 3000},
        }

    def validate_amenities(self, value):
        if not isinstance(value, list) or any(a not in Property.AMENITIES for a in value):
            raise serializers.ValidationError("Недопустимый список удобств.")
        return list(dict.fromkeys(value))

    def validate_contact_phone(self, value):
        if not value or not value.strip():
            return ""
        try:
            return normalize_phone(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages)

    def validate(self, attrs):
        listed = attrs.get("is_listed", getattr(self.instance, "is_listed", False))
        price = attrs.get("listing_price", getattr(self.instance, "listing_price", None))
        errors = {}
        if listed and not price:
            errors["listing_price"] = ["Укажите цену, чтобы показать объект в поиске."]
        phone = attrs.get("contact_phone", getattr(self.instance, "contact_phone", ""))
        owner = getattr(self.context.get("request"), "user", None)
        if listed and not phone and not getattr(owner, "phone", ""):
            errors["contact_phone"] = ["Укажите телефон, по которому с вами свяжутся."]
        floor = attrs.get("floor", getattr(self.instance, "floor", None))
        total = attrs.get("floors_total", getattr(self.instance, "floors_total", None))
        if floor is not None and total is not None and floor > total:
            errors["floor"] = ["Этаж не может быть больше этажности дома."]
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class TenantSerializer(serializers.ModelSerializer):
    telegram_linked = serializers.SerializerMethodField()
    is_linked = serializers.SerializerMethodField()
    invite_status = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = ("id", "full_name", "phone", "phone_claim_enabled", "passport", "notes", "language",
                  "telegram_linked", "is_linked", "invite_status", "created_at", "updated_at")
        read_only_fields = ("id", "telegram_linked", "is_linked", "invite_status", "created_at", "updated_at")

    def validate_phone(self, value):
        if not value or not value.strip():
            return ""
        try:
            return normalize_phone(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages)

    def get_telegram_linked(self, obj):
        return obj.telegram_chat_id is not None

    def get_is_linked(self, obj):
        return obj.user_id is not None

    def get_invite_status(self, obj):
        """none | pending | expired | used — по последнему приглашению (invites предзагружены во вьюхе)."""
        invites = list(obj.invites.all())
        if not invites:
            return "none"
        last = max(invites, key=lambda i: (i.created_at, i.pk))
        if last.revoked_at is not None:
            return "none"
        if last.used_at is not None:
            return "used"
        return "expired" if last.expires_at <= timezone.now() else "pending"


LOCKED_ON_UPDATE = ("property", "tenant", "start_date", "end_date", "rent_amount", "payment_day")


class LeaseSerializer(serializers.ModelSerializer):
    property = OwnedPrimaryKeyRelatedField(queryset=Property.objects.all())
    tenant = OwnedPrimaryKeyRelatedField(queryset=Tenant.objects.all())
    rent_amount = serializers.IntegerField(min_value=1)
    deposit_amount = serializers.IntegerField(min_value=0, required=False, default=0)
    payment_day = serializers.IntegerField(min_value=1, max_value=28)
    penalty_percent_per_day = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=0, max_value=10, required=False, default=0)
    penalty_cap_percent = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=0, max_value=100, required=False, default=100)
    payment_details = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    property_name = serializers.CharField(source="property.name", read_only=True)
    tenant_name = serializers.CharField(source="tenant.full_name", read_only=True)

    class Meta:
        model = Lease
        fields = ("id", "property", "property_name", "tenant", "tenant_name", "start_date", "end_date",
                  "rent_amount", "deposit_amount", "payment_day", "penalty_percent_per_day",
                  "penalty_cap_percent", "status", "notes", "inventory", "payment_details",
                  "created_at", "updated_at")
        read_only_fields = ("id", "status", "created_at", "updated_at")
        validators = []  # условное ограничение «один действующий договор» проверяем сами (понятный текст)

    def validate(self, attrs):
        if self.instance is not None:
            changed = [
                f for f in LOCKED_ON_UPDATE
                if f in attrs and attrs[f] != getattr(self.instance, f)
            ]
            if changed:
                raise serializers.ValidationError({
                    f: ["Поле нельзя изменить. Для даты окончания используйте продление, "
                        "для остального — завершите договор и создайте новый."]
                    for f in changed
                })
            return attrs
        if attrs["end_date"] <= attrs["start_date"]:
            raise serializers.ValidationError({"end_date": ["Дата окончания должна быть позже даты начала."]})
        if Lease.objects.filter(property=attrs["property"], status=Lease.Status.ACTIVE).exists():
            raise serializers.ValidationError({"property": ["На этот объект уже есть действующий договор."]})
        return attrs


class ExtendLeaseSerializer(serializers.Serializer):
    end_date = serializers.DateField()


class PaymentSerializer(serializers.ModelSerializer):
    status = serializers.CharField(read_only=True)
    remaining = serializers.IntegerField(read_only=True)
    days_overdue = serializers.IntegerField(read_only=True)
    penalty = serializers.IntegerField(read_only=True)
    property = serializers.IntegerField(source="lease.property_id", read_only=True)
    property_name = serializers.CharField(source="lease.property.name", read_only=True)
    tenant_name = serializers.CharField(source="lease.tenant.full_name", read_only=True)

    class Meta:
        model = Payment
        fields = ("id", "lease", "property", "property_name", "tenant_name", "due_date", "amount_due",
                  "amount_paid", "remaining", "days_overdue", "penalty", "status", "paid_at", "note")
        read_only_fields = fields


class PaySerializer(serializers.Serializer):
    amount = serializers.IntegerField(
        min_value=1, error_messages={"min_value": "Сумма должна быть больше нуля."}
    )
    idempotency_key = serializers.CharField(required=False, max_length=100)
