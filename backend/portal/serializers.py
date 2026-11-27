from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from core.phone import normalize_phone
from leasing.models import Lease, Payment
from users.models import User

from . import receipts
from .models import LeaseMedia, LeaseRequest, TenantMeterReading, PaymentReceipt, RepairRequest, TenantNotification
from .services import landlord_name


class TokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=200)


class ProfileFieldsMixin(serializers.Serializer):
    """Данные, которые жилец вводит сам (для приглашений от объекта)."""

    full_name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=32)

    def validate_phone(self, value):
        if not value.strip():
            return ""
        try:
            return normalize_phone(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages)


class AcceptSerializer(TokenSerializer, ProfileFieldsMixin):
    pass


class RegisterTenantSerializer(TokenSerializer, ProfileFieldsMixin):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150)

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Пользователь с таким email уже существует.")
        return value

    def validate_password(self, value):
        validate_password(value)
        return value


class PhoneRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32)


class PhoneVerifySerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32)
    code = serializers.CharField(max_length=10)


class TenantLeaseSerializer(serializers.ModelSerializer):
    """Договор глазами жильца: без заметок арендодателя и данных других людей."""

    property_name = serializers.CharField(source="property.name", read_only=True)
    property_address = serializers.CharField(source="property.address", read_only=True)
    landlord_name = serializers.SerializerMethodField()
    landlord_phone = serializers.SerializerMethodField()
    landlord_telegram = serializers.BooleanField(source="property.has_telegram", read_only=True)
    house_rules = serializers.CharField(source="property.house_rules", read_only=True)

    class Meta:
        model = Lease
        fields = ("id", "property_name", "property_address", "landlord_name", "landlord_phone",
                  "landlord_telegram", "house_rules", "start_date", "end_date",
                  "rent_amount", "deposit_amount", "payment_day", "inventory", "status")
        read_only_fields = fields

    def get_landlord_phone(self, obj):
        # телефон для связи объекта (если задан) или номер аккаунта владельца
        return obj.property.contact_phone.strip() or obj.owner.phone

    def get_landlord_name(self, obj):
        return landlord_name(obj.owner)


class TenantPaymentSerializer(serializers.ModelSerializer):
    status = serializers.CharField(read_only=True)
    remaining = serializers.IntegerField(read_only=True)
    property_name = serializers.CharField(source="lease.property.name", read_only=True)
    can_pay = serializers.SerializerMethodField()
    receipt_status = serializers.SerializerMethodField()
    receipt_reject_reason = serializers.SerializerMethodField()
    landlord_name = serializers.SerializerMethodField()
    payment_details = serializers.CharField(source="lease.get_payment_details", read_only=True)

    class Meta:
        model = Payment
        fields = ("id", "lease", "property_name", "due_date", "amount_due", "amount_paid", "remaining",
                  "status", "paid_at", "can_pay", "receipt_status", "receipt_reject_reason",
                  "landlord_name", "payment_details")
        read_only_fields = fields

    def get_can_pay(self, obj):
        return receipts.can_pay(obj)

    def get_receipt_status(self, obj):
        last = receipts.latest_receipt(obj)
        return last.status if last else "none"

    def get_receipt_reject_reason(self, obj):
        last = receipts.latest_receipt(obj)
        return last.reject_reason if last and last.status == "rejected" else ""

    def get_landlord_name(self, obj):
        return landlord_name(obj.lease.owner)


class ReceiptUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    amount = serializers.IntegerField(required=False, min_value=1)


class ReceiptSerializer(serializers.ModelSerializer):
    """Чек глазами арендодателя."""

    property_name = serializers.CharField(source="payment.lease.property.name", read_only=True)
    tenant_name = serializers.CharField(source="payment.lease.tenant.full_name", read_only=True)
    due_date = serializers.DateField(source="payment.due_date", read_only=True)
    amount_due = serializers.IntegerField(source="payment.amount_due", read_only=True)
    amount_paid = serializers.IntegerField(source="payment.amount_paid", read_only=True)

    class Meta:
        model = PaymentReceipt
        fields = ("id", "payment", "property_name", "tenant_name", "due_date", "amount_due", "amount_paid",
                  "amount", "status", "reject_reason", "original_name", "content_type", "created_at",
                  "reviewed_at")
        read_only_fields = fields


class ConfirmSerializer(serializers.Serializer):
    amount = serializers.IntegerField(required=False, min_value=1)


class BulkIdsSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(min_value=1), min_length=1, max_length=100)


class PushKeysSerializer(serializers.Serializer):
    p256dh = serializers.CharField(max_length=255)
    auth = serializers.CharField(max_length=255)


class PushSubscribeSerializer(serializers.Serializer):
    endpoint = serializers.URLField(max_length=2000)
    keys = PushKeysSerializer()


class PushUnsubscribeSerializer(serializers.Serializer):
    endpoint = serializers.URLField(max_length=2000)


class RejectSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=255)


class TenantProfileUpdateSerializer(serializers.Serializer):
    """Контактные данные жильца. Телефон — только контакт: вход по SMS идёт через отдельный аккаунт."""

    first_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=32)
    language = serializers.ChoiceField(required=False, choices=["ru", "uz"])
    share_reliability = serializers.BooleanField(required=False)

    def validate_phone(self, value):
        if not value.strip():
            return ""
        try:
            return normalize_phone(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages)


class TenantPasswordSerializer(serializers.Serializer):
    password = serializers.CharField(write_only=True, max_length=128)
    current_password = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=128)


class PhonePasswordSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=32)
    password = serializers.CharField(write_only=True, max_length=128)


class LeaseMediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaseMedia
        fields = ("id", "lease", "kind", "original_name", "content_type", "size", "created_at")
        read_only_fields = fields


class LeaseMediaUploadSerializer(serializers.Serializer):
    lease = serializers.IntegerField()
    file = serializers.FileField()


class MediaReplaceSerializer(serializers.Serializer):
    file = serializers.FileField()


class TenantNotificationSerializer(serializers.ModelSerializer):
    property_name = serializers.CharField(source="lease.property.name", read_only=True, default="")
    is_read = serializers.SerializerMethodField()

    class Meta:
        model = TenantNotification
        fields = ("id", "kind", "lease", "property_name", "count", "is_read", "created_at")
        read_only_fields = fields

    def get_is_read(self, obj):
        return obj.read_at is not None


# ---------- заявки жильца ----------

class RepairSerializer(serializers.ModelSerializer):
    property_name = serializers.CharField(source="lease.property.name", read_only=True)
    tenant_name = serializers.CharField(source="lease.tenant.full_name", read_only=True)
    has_photo = serializers.SerializerMethodField()

    class Meta:
        model = RepairRequest
        fields = ("id", "lease", "property_name", "tenant_name", "title", "description", "status",
                  "landlord_comment", "has_photo", "created_at", "resolved_at")
        read_only_fields = fields

    def get_has_photo(self, obj):
        return bool(obj.photo)


class RepairCreateSerializer(serializers.Serializer):
    lease = serializers.IntegerField()
    title = serializers.CharField(max_length=120)
    description = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")
    photo = serializers.FileField(required=False)


class RepairUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=RepairRequest.Status.choices)
    landlord_comment = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class TenantMeterSerializer(serializers.ModelSerializer):
    property_name = serializers.CharField(source="lease.property.name", read_only=True)
    tenant_name = serializers.CharField(source="lease.tenant.full_name", read_only=True)
    has_photo = serializers.SerializerMethodField()

    class Meta:
        model = TenantMeterReading
        fields = ("id", "lease", "property_name", "tenant_name", "kind", "period", "value", "has_photo",
                  "created_at", "updated_at")
        read_only_fields = fields

    def get_has_photo(self, obj):
        return bool(obj.photo)


class TenantMeterCreateSerializer(serializers.Serializer):
    lease = serializers.IntegerField()
    kind = serializers.ChoiceField(choices=TenantMeterReading.Kind.choices)
    value = serializers.IntegerField(min_value=0, max_value=10**10)
    photo = serializers.FileField(required=False)


class LeaseRequestSerializer(serializers.ModelSerializer):
    property_name = serializers.CharField(source="lease.property.name", read_only=True)
    tenant_name = serializers.CharField(source="lease.tenant.full_name", read_only=True)

    class Meta:
        model = LeaseRequest
        fields = ("id", "lease", "property_name", "tenant_name", "kind", "months", "move_out_date", "comment",
                  "status", "landlord_comment", "created_at", "resolved_at")
        read_only_fields = fields


class LeaseRequestCreateSerializer(serializers.Serializer):
    lease = serializers.IntegerField()
    kind = serializers.ChoiceField(choices=LeaseRequest.Kind.choices)
    months = serializers.IntegerField(min_value=1, max_value=60, required=False, allow_null=True)
    move_out_date = serializers.DateField(required=False, allow_null=True)
    comment = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class LeaseRequestResolveSerializer(serializers.Serializer):
    comment = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
