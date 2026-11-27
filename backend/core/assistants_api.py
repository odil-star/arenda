"""VIP: владелец заводит помощников и управляет ими. Сами помощники сюда попасть не могут (путь вне их белого списка)."""
import secrets

from django.db import transaction
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import User
from users.tokens import revoke_user_tokens

from .audit import log_action
from .integrations_api import IsVipLandlord
from .models import Assistant

MAX_ASSISTANTS = 5


def _item(link):
    user = link.user
    return {
        "id": link.pk, "email": user.email, "first_name": user.first_name, "last_name": user.last_name,
        "role": link.role, "is_active": link.is_active, "last_login": user.last_login, "created_at": link.created_at,
    }


def _temp_password():
    return secrets.token_urlsafe(9)  # ~12 знаков; показывается владельцу один раз


class AssistantInputSerializer(serializers.Serializer):
    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    role = serializers.ChoiceField(choices=Assistant.Role.choices)

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Пользователь с таким email уже существует.")
        return value


class AssistantPatchSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=Assistant.Role.choices, required=False)
    is_active = serializers.BooleanField(required=False)


class AssistantListView(APIView):
    permission_classes = [IsVipLandlord]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        links = Assistant.objects.filter(owner=request.user).select_related("user")
        return Response({"results": [_item(link) for link in links], "limit": MAX_ASSISTANTS})

    @extend_schema(request=AssistantInputSerializer, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request):
        """Завести помощника. Временный пароль возвращается один раз — передайте его человеку."""
        body = AssistantInputSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        v = body.validated_data
        # блокировка владельца: два одновременных запроса не обойдут лимит
        User.objects.select_for_update().get(pk=request.user.pk)
        if Assistant.objects.filter(owner=request.user).count() >= MAX_ASSISTANTS:
            raise serializers.ValidationError({"detail": [f"Не больше {MAX_ASSISTANTS} помощников."]})
        password = _temp_password()
        user = User.objects.create_user(v["email"], password, first_name=v["first_name"], last_name=v["last_name"],
                                        language=request.user.language)
        link = Assistant.objects.create(owner=request.user, user=user, role=v["role"])
        log_action(request.user, "assistant_create", link, actor=request.user, email=user.email, role=link.role)
        return Response({**_item(link), "password": password}, status=201)


class _AssistantBase(APIView):
    permission_classes = [IsVipLandlord]

    def _link(self, request, pk):
        link = Assistant.objects.filter(owner=request.user, pk=pk).select_related("user").first()
        if link is None:
            raise NotFound()
        return link


class AssistantDetailView(_AssistantBase):
    @extend_schema(request=AssistantPatchSerializer, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def patch(self, request, pk):
        link = self._link(request, pk)
        body = AssistantPatchSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        v = body.validated_data
        if "role" in v:
            link.role = v["role"]
        if "is_active" in v:
            link.is_active = v["is_active"]
            User.objects.filter(pk=link.user_id).update(is_active=v["is_active"])
            if not v["is_active"]:
                revoke_user_tokens(link.user)
        link.save()
        log_action(request.user, "assistant_update", link, actor=request.user, **v)
        return Response(_item(link))

    @extend_schema(responses={204: None})
    @transaction.atomic
    def delete(self, request, pk):
        """Убрать помощника насовсем: его вход и токены перестают работать."""
        link = self._link(request, pk)
        email = link.user.email
        revoke_user_tokens(link.user)
        link.user.delete()  # вместе с ним удалится запись помощника
        log_action(request.user, "assistant_delete", actor=request.user, email=email)
        return Response(status=204)


class AssistantResetPasswordView(_AssistantBase):
    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request, pk):
        link = self._link(request, pk)
        password = _temp_password()
        link.user.set_password(password)
        link.user.save(update_fields=["password"])
        revoke_user_tokens(link.user)
        log_action(request.user, "assistant_password_reset", link, actor=request.user)
        return Response({**_item(link), "password": password})
