"""Дополнение к API админа платформы: график по дням, рассылки, жильцы, договоры, администраторы."""
import logging
from datetime import datetime, time, timedelta

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import EmailMessage, get_connection
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.db import transaction
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from leasing.models import Lease, PaymentTransaction, Tenant
from reminders.channels import SendError, get_sender
from users.models import User

from .admin_api import ExportMixin, IsPlatformAdmin, IsPlatformSuperuser, _local, landlords_qs
from .audit import log_action
from .models import AdminMessage

logger = logging.getLogger(__name__)

DUPLICATE_WINDOW = timedelta(minutes=5)


# --- график по дням -----------------------------------------------------------------------------


class AdminDailyStatsView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        try:
            days = int(request.query_params.get("days", 30))
        except ValueError:
            days = 30
        days = max(7, min(days, 90))
        tz = timezone.get_current_timezone()
        today = timezone.localdate()
        first = today - timedelta(days=days - 1)
        since = datetime.combine(first, time.min, tzinfo=tz)

        joined = {
            r["d"]: r["c"]
            for r in landlords_qs().filter(date_joined__gte=since)
            .annotate(d=TruncDate("date_joined", tzinfo=tz)).values("d").annotate(c=Count("pk"))
        }
        manual = PaymentTransaction.Provider.MANUAL
        paid = {
            r["d"]: r
            for r in PaymentTransaction.objects.filter(state=PaymentTransaction.State.COMPLETED, performed_at__gte=since)
            .annotate(d=TruncDate("performed_at", tzinfo=tz)).values("d")
            .annotate(count=Count("pk"), total=Sum("amount"), online=Sum("amount", filter=~Q(provider=manual)))
        }
        series = []
        for i in range(days):
            d = first + timedelta(days=i)
            row = paid.get(d)
            series.append({
                "date": d.isoformat(),
                "new_landlords": joined.get(d, 0),
                "payments_count": row["count"] if row else 0,
                "payments_sum": (row["total"] or 0) if row else 0,
                "online_sum": (row["online"] or 0) if row else 0,
            })
        return Response(series)


# --- рассылки -----------------------------------------------------------------------------------


class AdminMessageSerializer(serializers.ModelSerializer):
    sender_email = serializers.SerializerMethodField()

    class Meta:
        model = AdminMessage
        fields = (
            "id", "sender_email", "subject", "body", "audience", "channels",
            "recipients_count", "email_sent", "telegram_sent", "failed", "created_at",
        )
        read_only_fields = fields

    def get_sender_email(self, obj):
        return obj.sender.email if obj.sender_id else None


class AdminMessageCreateSerializer(serializers.Serializer):
    subject = serializers.CharField(max_length=200)
    body = serializers.CharField(max_length=4000)
    audience = serializers.ChoiceField(choices=AdminMessage.Audience.choices)
    user_ids = serializers.ListField(child=serializers.IntegerField(), required=False, allow_empty=True)
    channels = serializers.ListField(child=serializers.ChoiceField(choices=["email", "telegram"]), min_length=1)

    def validate(self, attrs):
        if attrs["audience"] == AdminMessage.Audience.SELECTED and not attrs.get("user_ids"):
            raise serializers.ValidationError({"user_ids": "Выберите хотя бы одного получателя."})
        attrs["channels"] = sorted(set(attrs["channels"]))
        return attrs


class AdminMessageViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """История рассылок и отправка новой. Получатели — только активные арендодатели."""

    permission_classes = [IsPlatformSuperuser]
    queryset = AdminMessage.objects.select_related("sender")
    filter_backends: list = []

    def get_serializer_class(self):
        return AdminMessageCreateSerializer if self.action == "create" else AdminMessageSerializer

    @extend_schema(request=AdminMessageCreateSerializer, responses=AdminMessageSerializer)
    def create(self, request, *args, **kwargs):
        data = self.get_serializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data

        recipients = landlords_qs().filter(is_active=True)
        if v["audience"] == AdminMessage.Audience.SELECTED:
            recipients = recipients.filter(pk__in=v["user_ids"])
        recipients = list(recipients)
        if not recipients:
            raise serializers.ValidationError({"detail": "Нет получателей."})
        # Защита от двойной отправки (повторный клик, повтор после таймаута на клиенте)
        if AdminMessage.objects.filter(
            sender=request.user, subject=v["subject"], body=v["body"],
            created_at__gte=timezone.now() - DUPLICATE_WINDOW,
        ).exists():
            raise serializers.ValidationError({"detail": "Такая рассылка только что уже отправлена."})

        text = v["body"]
        sender = get_sender() if "telegram" in v["channels"] else None
        # Одно SMTP-соединение на всю рассылку, а не новое на каждое письмо
        connection = None
        if "email" in v["channels"]:
            try:
                connection = get_connection()
                connection.open()
            except Exception:  # noqa: BLE001
                logger.exception("Рассылка: почтовый сервер недоступен")
                connection = None
        email_sent = telegram_sent = failed = 0
        try:
            for user in recipients:
                delivered = False
                if connection is not None:
                    try:
                        EmailMessage(v["subject"], text, to=[user.email], connection=connection).send()
                        email_sent += 1
                        delivered = True
                    except Exception:  # noqa: BLE001
                        logger.exception("Рассылка: не удалось отправить письмо user=%s", user.pk)
                if sender is not None and user.telegram_chat_id:
                    try:
                        sender.send(user.telegram_chat_id, f"{v['subject']}\n\n{text}")
                        telegram_sent += 1
                        delivered = True
                    except SendError as exc:
                        logger.warning("Рассылка: Telegram недоступен user=%s: %s", user.pk, exc)
                        if str(exc).startswith("Нет связи"):
                            sender = None  # сеть до Telegram недоступна — не ждём таймаут на каждом получателе
                if not delivered:
                    failed += 1
        finally:
            if connection is not None:
                connection.close()

        message = AdminMessage.objects.create(
            sender=request.user, subject=v["subject"], body=text, audience=v["audience"], channels=v["channels"],
            recipients_count=len(recipients), email_sent=email_sent, telegram_sent=telegram_sent, failed=failed,
        )
        for user in recipients:
            log_action(user, "admin_message", message, actor=request.user, subject=v["subject"])
        return Response(AdminMessageSerializer(message).data, status=status.HTTP_201_CREATED)


# --- жильцы и договоры --------------------------------------------------------------------------


class AdminTenantSerializer(serializers.ModelSerializer):
    owner_email = serializers.CharField(source="owner.email", read_only=True)
    leases_count = serializers.IntegerField(read_only=True)
    has_account = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = ("id", "full_name", "phone", "owner", "owner_email", "leases_count", "has_account", "created_at")
        read_only_fields = fields

    def get_has_account(self, obj):
        return obj.user_id is not None


class AdminTenantViewSet(ExportMixin, viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = AdminTenantSerializer
    queryset = Tenant.objects.select_related("owner").annotate(leases_count=Count("leases")).order_by("full_name", "id")
    filterset_fields = ("owner",)
    search_fields = ("full_name", "phone", "owner__email")
    export_name = "tenants"
    export_header = ("Жилец", "Телефон", "Арендодатель", "Договоры", "Есть аккаунт", "Добавлен")

    def export_row(self, t):
        return (
            t.full_name, t.phone, t.owner.email, t.leases_count, "да" if t.user_id else "нет", _local(t.created_at),
        )


class AdminLeaseSerializer(serializers.ModelSerializer):
    owner_email = serializers.CharField(source="owner.email", read_only=True)
    property_name = serializers.CharField(source="property.name", read_only=True)
    tenant_name = serializers.CharField(source="tenant.full_name", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Lease
        fields = (
            "id", "owner", "owner_email", "property_name", "tenant_name", "start_date", "end_date",
            "rent_amount", "status", "status_label",
        )
        read_only_fields = fields


class AdminLeaseViewSet(ExportMixin, viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = AdminLeaseSerializer
    queryset = Lease.objects.select_related("owner", "property", "tenant")
    filterset_fields = ("owner", "status")
    search_fields = ("tenant__full_name", "property__name", "owner__email")
    export_name = "leases"
    export_header = ("Арендодатель", "Объект", "Жилец", "Начало", "Конец", "Аренда в месяц", "Статус")

    def export_row(self, lease):
        return (
            lease.owner.email, lease.property.name, lease.tenant.full_name, lease.start_date, lease.end_date,
            lease.rent_amount, lease.get_status_display(),
        )


# --- администраторы платформы -------------------------------------------------------------------


class AdminAdminSerializer(serializers.ModelSerializer):
    is_self = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "is_active", "date_joined", "last_login", "is_self", "role")
        read_only_fields = fields

    def get_role(self, obj):
        return "admin" if obj.is_superuser else "support"

    def get_is_self(self, obj):
        return obj.pk == self.context["request"].user.pk


class AdminAdminCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=["admin", "support"], default="admin")

    def validate_email(self, value):
        email = value.strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("Пользователь с таким email уже есть.")
        return email

    def validate_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from None
        return value


class AdminAdminViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    """Сотрудники платформы: администраторы и поддержка. Снятие прав оставляет обычный аккаунт."""

    permission_classes = [IsPlatformSuperuser]
    queryset = User.objects.filter(Q(is_superuser=True) | Q(is_staff=True)).order_by("date_joined", "id")
    filter_backends: list = []
    pagination_class = None

    def get_serializer_class(self):
        return AdminAdminCreateSerializer if self.action == "create" else AdminAdminSerializer

    @extend_schema(request=AdminAdminCreateSerializer, responses=AdminAdminSerializer)
    def create(self, request, *args, **kwargs):
        data = self.get_serializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        first_name = v.get("first_name", "")
        if v["role"] == "admin":
            user = User.objects.create_superuser(v["email"], v["password"], first_name=first_name)
        else:  # поддержка: персонал без права superuser — только просмотр
            user = User.objects.create_user(v["email"], v["password"], first_name=first_name, is_staff=True)
        log_action(user, "admin_grant", user, actor=request.user, role=v["role"])
        return Response(AdminAdminSerializer(user, context={"request": request}).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        with transaction.atomic():
            # блокируем всех администраторов: два одновременных запроса не снимут права друг у друга
            list(User.objects.select_for_update().filter(is_superuser=True).values_list("pk", flat=True))
            user = self.get_object()
            if user.pk == request.user.pk:
                raise serializers.ValidationError({"detail": "Нельзя снять права с самого себя."})
            if user.is_superuser and not User.objects.filter(is_superuser=True, is_active=True).exclude(pk=user.pk).exists():
                raise serializers.ValidationError({"detail": "Нельзя убрать последнего администратора."})
            user.is_superuser = False
            user.is_staff = False
            user.save(update_fields=["is_superuser", "is_staff"])
            log_action(user, "admin_revoke", user, actor=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
