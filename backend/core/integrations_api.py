"""VIP: настройки интеграций (ключ, webhook) и выгрузки данных для бухгалтерии и по API."""
import csv
import io
import secrets
import uuid

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import generics, serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from leasing.models import Lease, Payment, PaymentTransaction, Property, Tenant

from .audit import log_action
from .authentication import ReadOnlyImpersonationJWTAuthentication
from .integrations import (
    ApiKeyAuthentication, DeliveryError, UnsafeUrl, issue_api_key, post_event, record_result, resolve_public,
)
from .models import ApiKey, Webhook
from .permissions import IsLandlord
from .tiers import has_tier

NEED_VIP = "Интеграции доступны на тарифе VIP."
MAX_CSV_ROWS = 20_000


class IsVipLandlord(IsLandlord):
    message = NEED_VIP

    def has_permission(self, request, view):
        return super().has_permission(request, view) and has_tier(request.user, "vip")


# ---------- настройки ----------

def _status(user):
    key = ApiKey.objects.filter(user=user).first()
    hook = Webhook.objects.filter(user=user).first()
    return {
        "available": has_tier(user, "vip"),
        "api_key": {"prefix": key.prefix, "created_at": key.created_at, "last_used_at": key.last_used_at} if key else None,
        "webhook": {
            "url": hook.url, "is_active": hook.is_active, "last_status": hook.last_status,
            "last_error": hook.last_error, "last_attempt_at": hook.last_attempt_at,
        } if hook else None,
    }


class IntegrationsView(APIView):
    """GET /api/integrations/ — что настроено. Доступно всем арендодателям: на Free видно, что функция закрыта."""

    permission_classes = [IsLandlord]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_status(request.user))


class VipSettingsView(APIView):
    permission_classes = [IsVipLandlord]


class ApiKeyView(VipSettingsView):
    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        """Выпустить (или перевыпустить) ключ. Открытый ключ возвращается только здесь."""
        key, raw = issue_api_key(request.user)
        log_action(request.user, "api_key_issue", actor=request.user)
        return Response({**_status(request.user), "secret": raw}, status=201)

    @extend_schema(responses={204: None})
    def delete(self, request):
        if ApiKey.objects.filter(user=request.user).delete()[0]:
            log_action(request.user, "api_key_revoke", actor=request.user)
        return Response(status=204)


class WebhookInputSerializer(serializers.Serializer):
    url = serializers.CharField(max_length=500)
    is_active = serializers.BooleanField(required=False, default=True)

    def validate_url(self, value):
        try:
            resolve_public(value)
        except UnsafeUrl as exc:
            raise serializers.ValidationError(str(exc)) from None
        return value.strip()


class WebhookView(VipSettingsView):
    @extend_schema(request=WebhookInputSerializer, responses=OpenApiTypes.OBJECT)
    def put(self, request):
        """Задать адрес. При первом создании в ответе есть секрет подписи — потом он не показывается."""
        body = WebhookInputSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        hook = Webhook.objects.filter(user=request.user).first()
        secret = None
        if hook is None:
            secret = secrets.token_urlsafe(32)
            hook = Webhook(user=request.user, secret=secret)
        hook.url = body.validated_data["url"]
        hook.is_active = body.validated_data["is_active"]
        if hook.is_active:
            hook.failures = 0  # включили заново — считаем неудачи с нуля
        hook.save()
        log_action(request.user, "webhook_set", actor=request.user, url=hook.url)
        data = _status(request.user)
        return Response({**data, "secret": secret} if secret else data)

    @extend_schema(responses={204: None})
    def delete(self, request):
        if Webhook.objects.filter(user=request.user).delete()[0]:
            log_action(request.user, "webhook_delete", actor=request.user)
        return Response(status=204)


class WebhookRotateView(VipSettingsView):
    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        hook = Webhook.objects.filter(user=request.user).first()
        if hook is None:
            raise PermissionDenied("Сначала укажите адрес webhook.")
        hook.secret = secrets.token_urlsafe(32)
        hook.save(update_fields=["secret"])
        log_action(request.user, "webhook_rotate", actor=request.user)
        return Response({**_status(request.user), "secret": hook.secret})


class WebhookTestView(VipSettingsView):
    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        """Отправить событие ping сразу, без очереди и повторов, — чтобы проверить адрес и подпись."""
        hook = Webhook.objects.filter(user=request.user).first()
        if hook is None:
            raise PermissionDenied("Сначала укажите адрес webhook.")
        try:
            status = post_event(hook.url, hook.secret, "ping", uuid.uuid4().hex, {"message": "ping"})
            record_result(hook, ok=True, status=status)
            return Response({"ok": True, "status": status})
        except DeliveryError as exc:
            record_result(hook, ok=False, error=str(exc))
            return Response({"ok": False, "error": str(exc)})


# ---------- выгрузки ----------

class ExportThrottle(UserRateThrottle):
    scope = "api_export"


class ExportView(generics.ListAPIView):
    """Базовая выгрузка: ключ API или обычный вход; только чтение; только VIP. ?file=csv — таблица для бухгалтерии."""

    authentication_classes = [ApiKeyAuthentication, ReadOnlyImpersonationJWTAuthentication]
    permission_classes = [IsVipLandlord]
    throttle_classes = [ExportThrottle]
    filter_backends: list = []
    csv_columns: list = []
    csv_name = "export"

    def initial(self, request, *args, **kwargs):
        if request.method not in SAFE_METHODS:
            raise PermissionDenied("Ключ API работает только на чтение.")
        super().initial(request, *args, **kwargs)

    def list(self, request, *args, **kwargs):
        if request.query_params.get("file") != "csv":
            return super().list(request, *args, **kwargs)
        rows = self.get_serializer(self.filter_queryset(self.get_queryset())[:MAX_CSV_ROWS], many=True).data
        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter=";")
        writer.writerow(self.csv_columns)
        for row in rows:
            writer.writerow([_safe(row[c]) if row[c] is not None else "" for c in self.csv_columns])
        response = HttpResponse(("﻿" + buffer.getvalue()).encode("utf-8"), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{self.csv_name}.csv"'
        return response

    def date_range(self, field):
        qs = {}
        for key, lookup in (("date_from", "gte"), ("date_to", "lte")):
            value = self.request.query_params.get(key)
            if value:
                try:
                    qs[f"{field}__{lookup}"] = serializers.DateField().to_internal_value(value)
                except serializers.ValidationError:
                    raise serializers.ValidationError({key: ["Дата в формате ГГГГ-ММ-ДД."]}) from None
        return qs


def _safe(value):
    """Защита от формул в Excel: текст, начинающийся с = + - @, считается текстом."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


class PaymentExportSerializer(serializers.ModelSerializer):
    property = serializers.CharField(source="lease.property.name")
    tenant = serializers.CharField(source="lease.tenant.full_name")
    status = serializers.CharField()

    class Meta:
        model = Payment
        fields = ("id", "lease", "property", "tenant", "due_date", "amount_due", "amount_paid", "status", "paid_at")


class PaymentExportView(ExportView):
    """GET /api/v1/payments/?date_from=&date_to= — график платежей и что оплачено."""

    serializer_class = PaymentExportSerializer
    csv_name = "payments"
    csv_columns = ["id", "property", "tenant", "due_date", "amount_due", "amount_paid", "status", "paid_at"]

    def get_queryset(self):
        return (Payment.objects.filter(owner=self.request.user, **self.date_range("due_date"))
                .select_related("lease__property", "lease__tenant").order_by("due_date", "id"))


class TransactionExportSerializer(serializers.ModelSerializer):
    property = serializers.CharField(source="payment.lease.property.name")
    tenant = serializers.CharField(source="payment.lease.tenant.full_name")
    due_date = serializers.DateField(source="payment.due_date")

    class Meta:
        model = PaymentTransaction
        fields = ("id", "payment", "property", "tenant", "due_date", "provider", "external_id", "amount", "performed_at")


class TransactionExportView(ExportView):
    """GET /api/v1/transactions/?date_from=&date_to= — журнал фактических поступлений (для бухучёта)."""

    serializer_class = TransactionExportSerializer
    csv_name = "transactions"
    csv_columns = ["performed_at", "property", "tenant", "due_date", "provider", "external_id", "amount"]

    def get_queryset(self):
        return (PaymentTransaction.objects
                .filter(owner=self.request.user, state=PaymentTransaction.State.COMPLETED,
                        **self.date_range("performed_at__date"))
                .select_related("payment__lease__property", "payment__lease__tenant").order_by("performed_at", "id"))


class LeaseExportSerializer(serializers.ModelSerializer):
    property = serializers.CharField(source="property.name")
    tenant = serializers.CharField(source="tenant.full_name")

    class Meta:
        model = Lease
        fields = ("id", "property", "tenant", "start_date", "end_date", "rent_amount", "deposit_amount",
                  "payment_day", "status")


class LeaseExportView(ExportView):
    serializer_class = LeaseExportSerializer
    csv_name = "leases"
    csv_columns = ["id", "property", "tenant", "start_date", "end_date", "rent_amount", "deposit_amount",
                   "payment_day", "status"]

    def get_queryset(self):
        return Lease.objects.filter(owner=self.request.user).select_related("property", "tenant").order_by("id")


class PropertyExportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Property
        fields = ("id", "name", "address", "kind", "area_m2", "is_under_repair")


class PropertyExportView(ExportView):
    serializer_class = PropertyExportSerializer
    csv_name = "properties"
    csv_columns = ["id", "name", "address", "kind", "area_m2", "is_under_repair"]

    def get_queryset(self):
        return Property.objects.filter(owner=self.request.user).order_by("id")


class TenantExportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = ("id", "full_name", "phone")  # паспорт и заметки наружу не отдаём


class TenantExportView(ExportView):
    serializer_class = TenantExportSerializer
    csv_name = "tenants"
    csv_columns = ["id", "full_name", "phone"]

    def get_queryset(self):
        return Tenant.objects.filter(owner=self.request.user).order_by("id")
