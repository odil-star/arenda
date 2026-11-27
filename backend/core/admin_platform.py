"""Админ платформы: состояние сервиса, журнал вебхуков, объявления, заметки, тарифы."""
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.db.models import Count, Max
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from leasing.models import Lease
from reminders.models import NotificationLog

from .admin_api import IsPlatformAdmin, landlords_qs
from .audit import log_action
from .models import AdminNote, Announcement, AuditLog, Plan, Subscription, WebhookLog
from .tasks import ALERT_ACTION, recent_problem_count


# --- состояние сервиса --------------------------------------------------------------------------


def _check(fn):
    try:
        return "ok" if fn() else "fail"
    except Exception:  # noqa: BLE001
        return "fail"


def _db_ok():
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return True


def _cache_ok():
    cache.set("admin-system-check", 1, 5)
    return cache.get("admin-system-check") == 1


class AdminSystemView(APIView):
    """Что работает, а что нет — только факты из БД и настроек, секретов не отдаём."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        now = timezone.now()
        day = now - timedelta(hours=24)
        backend = settings.EMAIL_BACKEND.lower()
        logs = NotificationLog.objects
        Status = NotificationLog.Status
        last_alert = AuditLog.objects.filter(action=ALERT_ACTION).aggregate(m=Max("created_at"))["m"]
        webhooks = WebhookLog.objects

        def last_hook(provider):
            return webhooks.filter(provider=provider).aggregate(m=Max("created_at"))["m"]

        return Response({
            "time": now,
            "checks": {"database": _check(_db_ok), "cache": _check(_cache_ok)},
            "services": {
                "email_real": "smtp" in backend,
                "email_backend": "smtp" if "smtp" in backend else backend.rsplit(".", 2)[-2],
                "telegram_configured": bool(settings.TELEGRAM_BOT_TOKEN),
                "sms_configured": bool(getattr(settings, "ESKIZ_EMAIL", "")),
                "payme_configured": bool(settings.PAYME_KEY and settings.PAYME_MERCHANT_ID),
                "click_configured": bool(settings.CLICK_SECRET_KEY and settings.CLICK_SERVICE_ID),
                "celery_eager": settings.CELERY_TASK_ALWAYS_EAGER,
            },
            "reminders": {
                "last_sent_at": logs.filter(status=Status.SENT).aggregate(m=Max("sent_at"))["m"],
                "sent_24h": logs.filter(status=Status.SENT, sent_at__gte=day).count(),
                "failed_24h": logs.filter(status=Status.FAILED, created_at__gte=day).count(),
                "stuck": logs.filter(status=Status.PENDING, created_at__lt=now - timedelta(hours=1)).count(),
                "last_error": logs.filter(status=Status.FAILED).order_by("-created_at").values_list("error", flat=True).first() or "",
            },
            "leases": {
                # действующие договоры с истёкшим сроком: если растёт — ночная задача не работает
                "expired_still_active": Lease.objects.filter(
                    status=Lease.Status.ACTIVE, end_date__lt=timezone.localdate()
                ).count(),
            },
            "webhooks": {
                "last_payme_at": last_hook("payme"),
                "last_click_at": last_hook("click"),
                "failed_24h": webhooks.filter(ok=False, created_at__gte=day).count(),
            },
            "alerts": {
                "threshold": settings.ADMIN_ALERT_PROBLEM_THRESHOLD,
                "problem_24h": recent_problem_count(now),
                "last_alert_at": last_alert,
            },
        })


# --- журнал вебхуков ----------------------------------------------------------------------------


class AdminWebhookLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = WebhookLog
        fields = (
            "id", "provider", "method", "ok", "error_code", "payment_id", "request", "response",
            "remote_addr", "duration_ms", "created_at",
        )
        read_only_fields = fields


class AdminWebhookLogViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = AdminWebhookLogSerializer
    queryset = WebhookLog.objects.all()
    filterset_fields = ("provider", "ok", "method")
    search_fields = ("method", "error_code")

    def get_queryset(self):
        qs = super().get_queryset()
        payment = self.request.query_params.get("payment")
        if payment and payment.isdigit():
            qs = qs.filter(payment_id=int(payment))
        return qs


# --- объявления ---------------------------------------------------------------------------------


class AdminAnnouncementSerializer(serializers.ModelSerializer):
    created_by_email = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = ("id", "text_ru", "text_uz", "level", "is_active", "created_by_email", "created_at", "updated_at")
        read_only_fields = ("id", "created_by_email", "created_at", "updated_at")

    def get_created_by_email(self, obj):
        return obj.created_by.email if obj.created_by_id else None


class AdminAnnouncementViewSet(viewsets.ModelViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = AdminAnnouncementSerializer
    queryset = Announcement.objects.select_related("created_by")
    filter_backends: list = []

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        log_action(self.request.user, "admin_announcement_create", obj, actor=self.request.user)

    def perform_update(self, serializer):
        obj = serializer.save()
        log_action(self.request.user, "admin_announcement_update", obj, actor=self.request.user, active=obj.is_active)

    def perform_destroy(self, instance):
        log_action(self.request.user, "admin_announcement_delete", instance, actor=self.request.user)
        instance.delete()


class ActiveAnnouncementsView(APIView):
    """Включённые объявления — для баннера в кабинете арендодателя и жильца."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        rows = Announcement.objects.filter(is_active=True).order_by("created_at", "id")
        return Response([{"id": a.id, "text_ru": a.text_ru, "text_uz": a.text_uz, "level": a.level} for a in rows])


# --- заметки об арендодателях -------------------------------------------------------------------


class AdminNoteSerializer(serializers.ModelSerializer):
    user = serializers.PrimaryKeyRelatedField(queryset=landlords_qs())
    author_email = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    text = serializers.CharField(max_length=1000)

    class Meta:
        model = AdminNote
        fields = ("id", "user", "text", "author_email", "can_delete", "created_at")
        read_only_fields = ("id", "author_email", "can_delete", "created_at")

    def get_author_email(self, obj):
        return obj.author.email if obj.author_id else None

    def get_can_delete(self, obj):
        me = self.context["request"].user
        return me.is_superuser or obj.author_id == me.pk

    def validate_text(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Введите текст заметки.")
        return value


class AdminNoteViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    """Заметки доступны и поддержке: писать и удалять свои она может, остальное — только просмотр."""

    permission_classes = [IsPlatformAdmin]
    support_actions = ("create", "destroy")
    serializer_class = AdminNoteSerializer
    queryset = AdminNote.objects.select_related("author")
    filterset_fields = ("user",)

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)

    def perform_destroy(self, instance):
        me = self.request.user
        if not (me.is_superuser or instance.author_id == me.pk):
            raise PermissionDenied("Удалять можно только свои заметки.")
        instance.delete()


# --- тарифы -------------------------------------------------------------------------------------


class AdminPlanSerializer(serializers.ModelSerializer):
    users_count = serializers.IntegerField(read_only=True)
    max_properties = serializers.IntegerField(required=False, allow_null=True, min_value=1)

    class Meta:
        model = Plan
        fields = ("id", "name", "tier", "max_properties", "price", "is_active", "users_count")
        read_only_fields = ("id", "users_count")


class AdminPlanViewSet(viewsets.ModelViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = AdminPlanSerializer
    queryset = Plan.objects.annotate(users_count=Count("subscriptions"))
    filter_backends: list = []
    pagination_class = None

    def perform_create(self, serializer):
        plan = serializer.save()
        log_action(self.request.user, "admin_plan_create", plan, actor=self.request.user, name=plan.name)

    def perform_update(self, serializer):
        plan = serializer.save()
        log_action(self.request.user, "admin_plan_update", plan, actor=self.request.user, name=plan.name)

    def perform_destroy(self, instance):
        if Subscription.objects.filter(plan=instance).exists():
            raise serializers.ValidationError({"detail": "Тариф назначен арендодателям. Отключите его вместо удаления."})
        log_action(self.request.user, "admin_plan_delete", instance, actor=self.request.user, name=instance.name)
        instance.delete()
