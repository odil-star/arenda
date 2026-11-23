from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import generics, permissions, serializers
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .models import User
from .tokens import revoke_user_tokens
from .serializers import (
    PasswordChangeSerializer, PasswordResetConfirmSerializer, PasswordResetRequestSerializer, RegisterSerializer,
    UserSerializer,
)

logger = logging.getLogger(__name__)


class AuthThrottleMixin:
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class RegisterView(AuthThrottleMixin, generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    authentication_classes = []


class ThrottledTokenObtainPairView(AuthThrottleMixin, TokenObtainPairView):
    pass


class ThrottledTokenRefreshView(AuthThrottleMixin, TokenRefreshView):
    pass


class MeView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/me/ — профиль текущего пользователя."""

    serializer_class = UserSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_object(self):
        return self.request.user


class TelegramLinkView(APIView):
    """POST /api/me/telegram-link/ — одноразовый код для привязки Telegram владельца."""

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        user = request.user
        user.telegram_link_code = "O" + secrets.token_hex(4).upper()
        user.telegram_link_expires_at = timezone.now() + timedelta(hours=72)
        user.save(update_fields=["telegram_link_code", "telegram_link_expires_at"])
        return Response({"code": user.telegram_link_code, "expires_at": user.telegram_link_expires_at})

    @extend_schema(request=None, responses={204: None})
    def delete(self, request):
        """Отвязать Telegram."""
        user = request.user
        user.telegram_chat_id = None
        user.telegram_link_code = None
        user.telegram_link_expires_at = None
        user.save(update_fields=["telegram_chat_id", "telegram_link_code", "telegram_link_expires_at"])
        return Response(status=204)


class PasswordChangeView(AuthThrottleMixin, APIView):
    """POST /api/me/password/ {current_password, new_password} — смена пароля из профиля."""

    @extend_schema(request=PasswordChangeSerializer, responses={204: None})
    def post(self, request):
        body = PasswordChangeSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(body.validated_data["current_password"]):
            raise serializers.ValidationError({"current_password": ["Текущий пароль указан неверно."]})
        try:
            validate_password(body.validated_data["new_password"], user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)})
        user.set_password(body.validated_data["new_password"])
        user.save(update_fields=["password"])
        revoke_user_tokens(user)
        return Response(status=204)


def send_reset_email(user):
    """Письмо со ссылкой на смену пароля. Бросает исключение, если отправка не удалась."""
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    link = f"{settings.FRONTEND_URL}/reset-password/{uid}/{token}"
    send_mail(
        "Восстановление пароля",
        f"Чтобы задать новый пароль, перейдите по ссылке (действует 3 дня):\n{link}\n\n"
        "Если вы не запрашивали восстановление, просто проигнорируйте письмо.",
        None, [user.email],
    )


class PasswordResetRequestView(AuthThrottleMixin, APIView):
    """POST /api/auth/password-reset/ {email} — всегда 200, чтобы не раскрывать, есть ли такой email."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    @extend_schema(request=PasswordResetRequestSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        body = PasswordResetRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=body.validated_data["email"], is_active=True).first()
        if user is not None:
            try:
                send_reset_email(user)
            except Exception:  # noqa: BLE001 — ответ не должен выдавать, существует ли аккаунт
                logger.exception("Не удалось отправить письмо восстановления")
        return Response({"detail": "Если такой email зарегистрирован, мы отправили на него письмо."})


class PasswordResetConfirmView(AuthThrottleMixin, APIView):
    """POST /api/auth/password-reset/confirm/ {uid, token, password}"""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    @extend_schema(request=PasswordResetConfirmSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        body = PasswordResetConfirmSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        invalid = {"token": ["Ссылка недействительна или устарела."]}
        try:
            user = User.objects.get(pk=urlsafe_base64_decode(body.validated_data["uid"]).decode(), is_active=True)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            raise serializers.ValidationError(invalid)
        if not default_token_generator.check_token(user, body.validated_data["token"]):
            raise serializers.ValidationError(invalid)
        try:
            validate_password(body.validated_data["password"], user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        user.set_password(body.validated_data["password"])
        user.save(update_fields=["password"])
        revoke_user_tokens(user)
        return Response({"detail": "Пароль изменён."})
