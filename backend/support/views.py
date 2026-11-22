"""API чата с поддержкой.

Пользователь (арендодатель или жилец): /api/support/… — только свой диалог.
Сотрудник платформы: /api/admin/support/… — все диалоги; «поддержка» тоже может отвечать.
"""
from django.db.models import Count, F, OuterRef, Q, Subquery
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import filters, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import Throttled, ValidationError
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from core.admin_api import IsPlatformAdmin
from portal.throttling import hit

from . import services
from .models import StaffPresence, SupportMessage, SupportThread
from .serializers import AdminThreadSerializer, MessageInputSerializer, MessageSerializer

SEND_LIMIT, SEND_WINDOW = 20, 300  # не больше 20 сообщений за 5 минут от одного пользователя


class IsPlatformUser(BasePermission):
    """Арендодатель или жилец; сотрудники пишут через админский раздел."""

    message = "Чат с поддержкой доступен арендодателям и жильцам."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_active and not (user.is_staff or user.is_superuser))


def _cursor(request, name):
    raw = request.query_params.get(name)
    if raw in (None, ""):
        return None
    if not raw.isdigit():
        raise ValidationError({name: ["Ожидается число."]})
    return int(raw)


def _messages_response(request, qs, staff, extra):
    rows, has_more = services.page(qs, after=_cursor(request, "after"), before=_cursor(request, "before"))
    data = MessageSerializer(rows, many=True, context={"staff": staff}).data
    return Response({"results": data, "has_more": has_more, **extra})


def _body(request):
    s = MessageInputSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    return s.validated_data["body"]


class SupportMessagesView(APIView):
    permission_classes = [IsPlatformUser]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        thread = services.thread_for(request.user)
        extra = {
            "status": thread.status if thread else None,
            "unread": services.unread_for_user(thread),
            # «поддержка в сети» — без имён сотрудников; приходит с каждым опросом переписки
            "staff_online": services.staff_online(),
        }
        if thread is None:
            return Response({"results": [], "has_more": False, **extra})
        return _messages_response(request, thread.messages.select_related("author"), False, extra)

    @extend_schema(request=MessageInputSerializer, responses=MessageSerializer)
    def post(self, request):
        body = _body(request)
        if not hit(f"support_send:{request.user.pk}", SEND_LIMIT, SEND_WINDOW):
            raise Throttled(detail="Слишком много сообщений. Подождите несколько минут.")
        thread = services.thread_for(request.user, create=True)
        message = services.post_message(thread, request.user, body, from_staff=False)
        return Response(MessageSerializer(message).data, status=status.HTTP_201_CREATED)


class SupportReadView(APIView):
    permission_classes = [IsPlatformUser]

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        thread = services.thread_for(request.user)
        if thread is not None:
            services.mark_read(thread, by_staff=False)
        return Response({"unread": 0})


class SupportUnreadView(APIView):
    permission_classes = [IsPlatformUser]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response({"unread": services.unread_for_user(services.thread_for(request.user))})


# --- сотрудники платформы ---------------------------------------------------------------------


def _admin_threads():
    last = SupportMessage.objects.filter(thread=OuterRef("pk")).order_by("-id")
    return (
        SupportThread.objects.select_related("user", "user__profile")
        .filter(last_message_at__isnull=False)
        .annotate(
            unread=Count("messages", filter=Q(messages__from_staff=False, messages__id__gt=F("staff_last_read_id"))),
            last_body=Subquery(last.values("body")[:1]),
            last_from_staff=Subquery(last.values("from_staff")[:1]),
        )
    )


class StatusFilter(filters.BaseFilterBackend):
    def filter_queryset(self, request, queryset, view):
        value = request.query_params.get("status")
        if value in SupportThread.Status.values:
            queryset = queryset.filter(status=value)
        if request.query_params.get("unread") == "true":
            queryset = queryset.filter(unread__gt=0)
        return queryset


class AdminSupportThreadViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsPlatformAdmin]
    # отвечать в чате — основная работа поддержки, поэтому эти действия разрешены и роли «поддержка»
    support_actions = ("reply", "read", "close", "reopen")
    serializer_class = AdminThreadSerializer
    filter_backends = [StatusFilter, filters.SearchFilter]
    search_fields = ("user__email", "user__first_name", "user__last_name", "user__phone")

    def get_queryset(self):
        return _admin_threads().order_by("-last_message_at", "-id")

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"])
    def messages(self, request, pk=None):
        thread = self.get_object()
        return _messages_response(request, thread.messages.select_related("author"), True, {"status": thread.status})

    @extend_schema(request=MessageInputSerializer, responses=MessageSerializer)
    @action(detail=True, methods=["post"])
    def reply(self, request, pk=None):
        thread = self.get_object()
        message = services.post_message(thread, request.user, _body(request), from_staff=True)
        return Response(MessageSerializer(message, context={"staff": True}).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        services.mark_read(self.get_object(), by_staff=True)
        return Response({"unread": 0})

    def _set_status(self, value):
        thread = services.set_status(self.get_object(), value)
        return Response(self.get_serializer(self.get_queryset().get(pk=thread.pk)).data)

    @extend_schema(request=None, responses=AdminThreadSerializer)
    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        return self._set_status(SupportThread.Status.CLOSED)

    @extend_schema(request=None, responses=AdminThreadSerializer)
    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        return self._set_status(SupportThread.Status.OPEN)

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["get"])
    def unread(self, request):
        """Сколько диалогов ждут ответа (для значка в меню)."""
        return Response({"threads": _admin_threads().filter(unread__gt=0).count()})

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Сколько диалогов нужно ответить и сколько закрыто за сегодня (сутки заканчиваются в 23:59)."""
        return Response(services.admin_stats(_admin_threads()))


class AdminPresenceView(APIView):
    """Мой статус в чате. GET — заодно «я здесь» (админка вызывает раз в минуту), POST — сменить статус."""

    permission_classes = [IsPlatformAdmin]
    support_actions = ("presence",)  # «поддержка» тоже отвечает в чате и ставит свой статус
    action = "presence"

    def _data(self, presence):
        return {"status": presence.status, "online": services.is_online(presence), "anyone_online": services.staff_online()}

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        presence = services.presence_for(request.user)
        presence.last_seen = timezone.now()
        presence.save(update_fields=["last_seen", "updated_at"])
        return Response(self._data(presence))

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        value = request.data.get("status") if isinstance(request.data, dict) else None
        if value not in StaffPresence.Status.values:
            raise ValidationError({"status": ["Ожидается online или offline."]})
        presence = services.presence_for(request.user)
        presence.status = value
        presence.last_seen = timezone.now()
        presence.save(update_fields=["status", "last_seen", "updated_at"])
        return Response(self._data(presence))
