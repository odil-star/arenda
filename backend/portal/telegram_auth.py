"""Вход в мини-приложение Telegram: сервер проверяет подпись initData и выдаёт обычные JWT.

Подпись (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
secret = HMAC_SHA256("WebAppData", токен_бота); hash = HMAC_SHA256(secret, строка_данных).
Пользователя ищем по привязанному telegram_chat_id — в личном чате он равен id пользователя Telegram.
"""
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from django.conf import settings
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from leasing.models import Tenant
from users.models import User

from .throttling import IPWindowThrottle
from .views import PublicView

MAX_AGE_SECONDS = 24 * 3600


class TelegramAuthThrottle(IPWindowThrottle):
    scope, limit, window = "tg_auth", 30, 600


def validate_init_data(init_data, token, now=None, max_age=MAX_AGE_SECONDS):
    """Возвращает словарь пользователя Telegram или None, если подпись неверна / данные устарели."""
    if not init_data or not token:
        return None
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received = pairs.pop("hash", "")
    check = "\n".join(f"{key}={value}" for key, value in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not received or not hmac.compare_digest(expected, received):
        return None
    try:
        issued = int(pairs.get("auth_date", "0"))
        user = json.loads(pairs.get("user", ""))
    except (ValueError, TypeError):
        return None
    if (now if now is not None else time.time()) - issued > max_age or not isinstance(user, dict) or "id" not in user:
        return None
    return user


def user_for_chat(chat_id):
    """Аккаунт по привязанному чату: сначала владелец, затем жилец (с аккаунтом в приложении).

    Жилец — только если чат привязал он сам (telegram_login): код от арендодателя входа не даёт.
    """
    owner = User.objects.filter(telegram_chat_id=chat_id, is_active=True).first()
    if owner:
        return owner
    tenant = (Tenant.objects.filter(telegram_chat_id=chat_id, telegram_login=True, user__isnull=False,
                                    user__is_active=True)
              .select_related("user").order_by("id").first())
    return tenant.user if tenant else None


class InitDataBody(serializers.Serializer):
    init_data = serializers.CharField(max_length=4096)


class TelegramLoginView(PublicView):
    """POST /api/auth/telegram/ {init_data} → {access, refresh}. 400 not_linked — чат ещё не привязан."""

    throttle_classes = [TelegramAuthThrottle]

    @extend_schema(request=InitDataBody, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        body = InitDataBody(data=request.data)
        body.is_valid(raise_exception=True)
        tg_user = validate_init_data(body.validated_data["init_data"], settings.TELEGRAM_BOT_TOKEN)
        if tg_user is None:
            return Response({"detail": "Не удалось подтвердить вход через Telegram.", "code": "bad_init_data"},
                            status=status.HTTP_400_BAD_REQUEST)
        user = user_for_chat(tg_user["id"])
        if user is None:
            return Response({"detail": "Telegram ещё не привязан к аккаунту.", "code": "not_linked"},
                            status=status.HTTP_400_BAD_REQUEST)
        if user.is_staff or user.is_superuser:  # сотрудники платформы входят только паролем/passkey
            return Response({"detail": "Сотрудникам платформы вход через Telegram недоступен.",
                             "code": "staff_not_allowed"}, status=status.HTTP_403_FORBIDDEN)
        refresh = RefreshToken.for_user(user)
        return Response({"access": str(refresh.access_token), "refresh": str(refresh)})
