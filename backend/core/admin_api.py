"""API платформенного админа (суперпользователь): сводка, арендодатели, журнал, платежи провайдеров.

Админ только читает данные арендодателей; единственные изменения — блокировка/разблокировка
и письмо для сброса пароля. Каждое такое действие пишется в журнал (owner = затронутый арендодатель,
actor = админ).
"""
import csv
import logging
from datetime import date, timedelta

from django.db.models import Count, F, IntegerField, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import filters, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import AccessToken

from leasing.models import Lease, Payment, PaymentTransaction, Property, Tenant
from users.models import User
from users.views import send_reset_email

from .audit import log_action
from .authentication import IMPERSONATION_CLAIM
from .models import AdminNote, AuditLog, Plan, Subscription

EXPORT_LIMIT = 10_000
IMPERSONATION_MINUTES = 30

logger = logging.getLogger(__name__)


class IsPlatformAdmin(BasePermission):
    """Сотрудники платформы. Администратор (superuser) может всё.

    «Поддержка» (is_staff без is_superuser) — только просмотр: безопасные методы плюс действия,
    которые вьюха явно разрешила в `support_actions` (например, «войти как арендодатель»).
    """

    message = "Недостаточно прав: роль «поддержка» может только просматривать."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated and user.is_active):
            return False
        if user.is_superuser:
            return True
        if user.is_staff:
            action = getattr(view, "action", None)
            if action in getattr(view, "superuser_actions", ()):
                return False  # выгрузки ПДн — только полному администратору
            return request.method in SAFE_METHODS or action in getattr(view, "support_actions", ())
        return False


class IsPlatformSuperuser(BasePermission):
    """Только полный администратор (рассылки, управление админами)."""

    message = "Доступно только администратору."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_active and user.is_superuser)


def landlords_qs():
    """Арендодатели платформы: без администраторов и сотрудников поддержки."""
    return User.objects.filter(is_superuser=False, is_staff=False, profile__role="landlord")


def _cell(value):
    """Значение для CSV; защита от формул в Excel (=, +, -, @ в начале ячейки)."""
    if value is None:
        return ""
    text = str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def csv_response(filename, header, rows):
    """CSV для Excel: UTF-8 с BOM и разделитель «;» (русская локаль открывает без мастера импорта)."""
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.write("\ufeff")
    writer = csv.writer(response, delimiter=";")
    writer.writerow(header)
    for row in rows:
        writer.writerow([_cell(v) for v in row])
    return response


class ExportMixin:
    """GET .../export/ — выгрузка того, что админ видит в списке (с теми же фильтрами и поиском)."""

    export_name = "export"
    export_header: tuple = ()
    superuser_actions = ("export",)
    throttle_scope = "admin_sensitive"

    def get_throttles(self):
        # лимит на пользователя — только для выгрузок и входа «как арендодатель»
        if getattr(self, "action", None) in self.superuser_actions:
            return [ScopedRateThrottle()]
        return []

    def export_row(self, obj):  # pragma: no cover - переопределяется
        raise NotImplementedError

    @extend_schema(responses=OpenApiTypes.BINARY)
    @action(detail=False, methods=["get"])
    def export(self, request):
        qs = self.filter_queryset(self.get_queryset())[:EXPORT_LIMIT]
        stamp = timezone.localdate().isoformat()
        return csv_response(f"{self.export_name}-{stamp}.csv", self.export_header, (self.export_row(o) for o in qs))


def _local(value):
    return timezone.localtime(value).strftime("%Y-%m-%d %H:%M") if value else ""


def _count(model, **extra):
    """Подзапрос «сколько записей у этого владельца»."""
    return Coalesce(
        Subquery(
            model.objects.filter(owner=OuterRef("pk"), **extra)
            .order_by().values("owner").annotate(c=Count("pk")).values("c"),
            output_field=IntegerField(),
        ),
        0,
    )


def problem_transactions(qs):
    """Отменённые, возвращённые и «зависшие» (созданы, но не проведены больше суток) оплаты."""
    State = PaymentTransaction.State
    return qs.filter(
        Q(state__in=[State.CANCELLED, State.REFUNDED])
        | Q(state=State.CREATED, created_at__lt=timezone.now() - timedelta(days=1))
    )


class AdminStatsView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        now = timezone.now()
        today = timezone.localdate()
        month_start = now.astimezone(timezone.get_current_timezone()).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        landlords = landlords_qs()
        month_tx = PaymentTransaction.objects.filter(
            state=PaymentTransaction.State.COMPLETED, performed_at__gte=month_start,
        ).exclude(provider=PaymentTransaction.Provider.MANUAL)
        month_all = PaymentTransaction.objects.filter(
            state=PaymentTransaction.State.COMPLETED, performed_at__gte=month_start,
        )
        overdue = Payment.objects.filter(amount_paid__lt=F("amount_due"), due_date__lt=today)
        return Response({
            "landlords": landlords.count(),
            "landlords_blocked": landlords.filter(is_active=False).count(),
            "landlords_new_30d": landlords.filter(date_joined__gte=now - timedelta(days=30)).count(),
            "tenants": Tenant.objects.count(),
            "properties": Property.objects.count(),
            "active_leases": Lease.objects.filter(status=Lease.Status.ACTIVE).count(),
            "month_payments_count": month_all.count(),
            "month_payments_sum": month_all.aggregate(s=Coalesce(Sum("amount"), 0))["s"],
            "month_online_count": month_tx.count(),
            "month_online_sum": month_tx.aggregate(s=Coalesce(Sum("amount"), 0))["s"],
            "problem_payments": problem_transactions(PaymentTransaction.objects.all()).count(),
            "overdue_count": overdue.count(),
            "overdue_sum": overdue.aggregate(s=Coalesce(Sum(F("amount_due") - F("amount_paid")), 0))["s"],
        })


class AdminUserSerializer(serializers.ModelSerializer):
    properties_count = serializers.IntegerField(read_only=True)
    tenants_count = serializers.IntegerField(read_only=True)
    leases_count = serializers.IntegerField(read_only=True)
    telegram_linked = serializers.SerializerMethodField()
    plan = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id", "email", "first_name", "last_name", "phone", "is_active", "date_joined", "last_login",
            "telegram_linked", "properties_count", "tenants_count", "leases_count", "plan",
        )
        read_only_fields = fields

    def get_plan(self, obj):
        sub = getattr(obj, "subscription", None)  # нет записи — тариф не назначен
        if sub is None:
            return None
        expired = sub.paid_until is not None and sub.paid_until < timezone.localdate()
        return {
            "id": sub.plan_id, "name": sub.plan.name, "max_properties": sub.plan.max_properties,
            "paid_until": sub.paid_until, "expired": expired, "note": sub.note,
            "tier": sub.plan.tier, "manager_name": sub.manager_name, "manager_contact": sub.manager_contact,
        }

    def get_telegram_linked(self, obj):
        return obj.telegram_chat_id is not None


class SubscriptionInputSerializer(serializers.Serializer):
    plan = serializers.IntegerField(allow_null=True)
    paid_until = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)
    manager_name = serializers.CharField(required=False, allow_blank=True, max_length=100)
    manager_contact = serializers.CharField(required=False, allow_blank=True, max_length=255)


class AdminUserViewSet(ExportMixin, viewsets.ReadOnlyModelViewSet):
    export_name = "landlords"
    export_header = ("Email", "Имя", "Телефон", "Статус", "Объекты", "Жильцы", "Договоры", "Регистрация", "Последний вход")

    def export_row(self, u):
        return (
            u.email, f"{u.first_name} {u.last_name}".strip(), u.phone, "активен" if u.is_active else "заблокирован",
            u.properties_count, u.tenants_count, u.leases_count, _local(u.date_joined), _local(u.last_login),
        )

    permission_classes = [IsPlatformAdmin]
    superuser_actions = ("export", "impersonate")  # ПДн и вход «как арендодатель» — только полный админ
    serializer_class = AdminUserSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ("email", "phone", "first_name", "last_name")
    ordering_fields = ("date_joined", "last_login", "properties_count", "leases_count")
    ordering = ("-date_joined",)

    def get_queryset(self):
        qs = landlords_qs().select_related("subscription__plan").annotate(
            properties_count=_count(Property),
            tenants_count=_count(Tenant),
            leases_count=_count(Lease),
        )
        active = self.request.query_params.get("is_active")
        if active in ("true", "false"):
            qs = qs.filter(is_active=(active == "true"))
        return qs

    @action(detail=True, methods=["get"])
    def overview(self, request, pk=None):
        """Карточка арендодателя: объекты, действующие договоры, последние действия (только чтение)."""
        user = self.get_object()
        properties = list(
            Property.objects.filter(owner=user).order_by("name").values("id", "name", "address", "kind")[:50]
        )
        leases = list(
            Lease.objects.filter(owner=user, status=Lease.Status.ACTIVE)
            .select_related("property", "tenant").order_by("end_date")[:50]
            .values("id", "property__name", "tenant__full_name", "start_date", "end_date", "rent_amount")
        )
        activity = AuditLog.objects.filter(owner=user).select_related("actor").order_by("-created_at", "-id")[:20]
        payments = (
            PaymentTransaction.objects.filter(owner=user, state=PaymentTransaction.State.COMPLETED)
            .order_by("-performed_at", "-id")[:10]
        )
        notes = AdminNote.objects.filter(user=user).select_related("author")[:50]
        me = request.user
        return Response({
            "user": self.get_serializer(user).data,
            "activity": [
                {
                    "id": a.id, "action": a.action, "object_type": a.object_type, "object_id": a.object_id,
                    "actor_email": a.actor.email if a.actor_id else None, "created_at": a.created_at,
                }
                for a in activity
            ],
            "recent_payments": [
                {
                    "id": t.id, "amount": t.amount, "provider": t.provider, "performed_at": t.performed_at,
                    "lease": t.payment.lease_id,
                }
                for t in payments.select_related("payment")
            ],
            "notes": [
                {
                    "id": n.id, "author_email": n.author.email if n.author_id else None, "text": n.text,
                    "created_at": n.created_at, "can_delete": me.is_superuser or n.author_id == me.pk,
                }
                for n in notes
            ],
            "properties": properties,
            "active_leases": [
                {
                    "id": row["id"], "property": row["property__name"], "tenant": row["tenant__full_name"],
                    "start_date": row["start_date"], "end_date": row["end_date"], "rent_amount": row["rent_amount"],
                }
                for row in leases
            ],
        })

    def _set_active(self, request, active):
        user = self.get_object()
        if user.pk == request.user.pk:
            raise serializers.ValidationError({"detail": "Нельзя блокировать самого себя."})
        if user.is_active != active:
            user.is_active = active
            user.save(update_fields=["is_active"])
            log_action(user, "admin_unblock_user" if active else "admin_block_user", user, actor=request.user)
        return Response(self.get_serializer(self.get_queryset().get(pk=user.pk)).data)

    @action(detail=True, methods=["post"])
    def block(self, request, pk=None):
        return self._set_active(request, False)

    @action(detail=True, methods=["post"])
    def unblock(self, request, pk=None):
        return self._set_active(request, True)

    @extend_schema(request=SubscriptionInputSerializer, responses=AdminUserSerializer)
    @action(detail=True, methods=["post"], url_path="subscription")
    def set_subscription(self, request, pk=None):
        """Назначить тариф (или снять, если plan = null) и срок оплаты."""
        user = self.get_object()
        data = SubscriptionInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if v["plan"] is None:
            if Subscription.objects.filter(user=user).delete()[0]:
                log_action(user, "admin_subscription_clear", user, actor=request.user)
        else:
            plan = Plan.objects.filter(pk=v["plan"]).first()
            if plan is None:
                raise serializers.ValidationError({"plan": "Тариф не найден."})
            current = Subscription.objects.filter(user=user).first()
            if not plan.is_active and (current is None or current.plan_id != plan.pk):
                raise serializers.ValidationError({"plan": "Тариф отключён."})
            Subscription.objects.update_or_create(
                user=user, defaults={
                    "plan": plan, "paid_until": v.get("paid_until"), "note": v.get("note", ""),
                    "manager_name": v.get("manager_name", ""), "manager_contact": v.get("manager_contact", ""),
                },
            )
            log_action(
                user, "admin_subscription_set", user, actor=request.user,
                plan=plan.name, paid_until=str(v["paid_until"]) if v.get("paid_until") else "",
            )
        return Response(self.get_serializer(self.get_queryset().get(pk=user.pk)).data)

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"])
    def impersonate(self, request, pk=None):
        """Токен для просмотра сервиса глазами арендодателя: только чтение, действует 30 минут."""
        user = self.get_object()
        if not user.is_active:
            raise serializers.ValidationError({"detail": "Аккаунт заблокирован."})
        token = AccessToken.for_user(user)
        token.set_exp(lifetime=timedelta(minutes=IMPERSONATION_MINUTES))
        token[IMPERSONATION_CLAIM] = request.user.pk
        log_action(user, "admin_impersonate", user, actor=request.user)
        return Response({"access": str(token), "email": user.email, "expires_in": IMPERSONATION_MINUTES * 60})

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        user = self.get_object()
        if not user.is_active:
            raise serializers.ValidationError({"detail": "Аккаунт заблокирован."})
        try:
            send_reset_email(user)
        except Exception:  # noqa: BLE001
            logger.exception("Не удалось отправить письмо сброса пароля (admin)")
            raise serializers.ValidationError({"detail": "Не удалось отправить письмо."})
        log_action(user, "admin_reset_password", user, actor=request.user)
        return Response({"detail": "Письмо отправлено."})


class AdminAuditSerializer(serializers.ModelSerializer):
    owner_email = serializers.CharField(source="owner.email", read_only=True)
    actor_email = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = (
            "id", "owner", "owner_email", "actor", "actor_email", "action",
            "object_type", "object_id", "details", "created_at",
        )

    def get_actor_email(self, obj):
        return obj.actor.email if obj.actor_id else None


class AdminAuditViewSet(ExportMixin, viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = AdminAuditSerializer
    queryset = AuditLog.objects.select_related("owner", "actor")
    filterset_fields = ("owner", "action", "actor")
    search_fields = ("owner__email", "actor__email", "action")
    export_name = "audit"
    export_header = ("Время", "Арендодатель", "Кто сделал", "Действие", "Объект")

    def export_row(self, e):
        obj = f"{e.object_type} #{e.object_id}" if e.object_type else ""
        return (_local(e.created_at), e.owner.email, e.actor.email if e.actor_id else "система", e.action, obj)

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        # даты — по местному времени (YYYY-MM-DD); неверный формат просто игнорируем
        for key, lookup in (("date_from", "created_at__date__gte"), ("date_to", "created_at__date__lte")):
            value = params.get(key)
            if value:
                try:
                    qs = qs.filter(**{lookup: date.fromisoformat(value)})
                except ValueError:
                    pass
        return qs

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["get"], url_path="actions")
    def action_list(self, request):
        """Какие действия встречаются в журнале (для фильтра)."""
        names = AuditLog.objects.order_by().values_list("action", flat=True).distinct()
        return Response(sorted(names))


class AdminTransactionSerializer(serializers.ModelSerializer):
    owner_email = serializers.CharField(source="owner.email", read_only=True)
    state_label = serializers.CharField(source="get_state_display", read_only=True)
    lease = serializers.IntegerField(source="payment.lease_id", read_only=True)

    class Meta:
        model = PaymentTransaction
        fields = (
            "id", "owner", "owner_email", "provider", "external_id", "amount", "state", "state_label",
            "lease", "payment", "performed_at", "cancelled_at", "created_at",
        )


class AdminTransactionViewSet(ExportMixin, viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = AdminTransactionSerializer
    queryset = PaymentTransaction.objects.select_related("owner", "payment")
    filterset_fields = ("provider", "state", "owner")
    search_fields = ("external_id", "owner__email")
    export_name = "payments"
    export_header = ("Дата", "Арендодатель", "Провайдер", "ID", "Сумма", "Статус", "Договор")

    def export_row(self, t):
        return (
            _local(t.performed_at or t.created_at), t.owner.email, t.get_provider_display(), t.external_id,
            t.amount, t.get_state_display(), t.payment.lease_id,
        )

    def get_queryset(self):
        qs = super().get_queryset()
        # по умолчанию только онлайн-оплаты; ручные видны по ?provider=manual
        if "provider" not in self.request.query_params:
            qs = qs.exclude(provider=PaymentTransaction.Provider.MANUAL)
        # ?problem=1 — отменённые, возвращённые и зависшие оплаты
        if self.request.query_params.get("problem") in ("1", "true"):
            qs = problem_transactions(qs)
        return qs


class AdminProfileView(APIView):
    """GET /api/admin/me/ — данные текущего сотрудника для его профиля: роль, вход, активность, поддержка."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        from support.models import StaffPresence, SupportMessage, SupportThread
        from support.services import is_online

        user = request.user
        now = timezone.now()
        today_start = now.astimezone(timezone.get_current_timezone()).replace(hour=0, minute=0, second=0, microsecond=0)
        week, month = now - timedelta(days=7), now - timedelta(days=30)

        mine = AuditLog.objects.filter(actor=user)
        counts = mine.aggregate(
            today=Count("id", filter=Q(created_at__gte=today_start)),
            week=Count("id", filter=Q(created_at__gte=week)),
            month=Count("id", filter=Q(created_at__gte=month)),
            total=Count("id"),
        )
        recent = [
            {
                "id": e.id, "action": e.action, "object_type": e.object_type, "object_id": e.object_id,
                "owner_email": e.owner.email, "created_at": e.created_at,
            }
            for e in mine.select_related("owner")[:8]
        ]

        replies = SupportMessage.objects.filter(author=user, from_staff=True)
        support = replies.aggregate(
            today=Count("id", filter=Q(created_at__gte=today_start)),
            week=Count("id", filter=Q(created_at__gte=week)),
            month=Count("id", filter=Q(created_at__gte=month)),
            total=Count("id"),
            threads_month=Count("thread", filter=Q(created_at__gte=month), distinct=True),
        )
        support["open_threads"] = SupportThread.objects.filter(status=SupportThread.Status.OPEN).count()

        presence = StaffPresence.objects.filter(user=user).first()
        return Response({
            "admin_role": "admin" if user.is_superuser else "support",
            "date_joined": user.date_joined,
            "last_login": user.last_login,
            "presence": {
                "online": bool(presence) and is_online(presence, now),
                "last_seen": presence.last_seen if presence else None,
            },
            "activity": {**counts, "recent": recent},
            "support": support,
        })
