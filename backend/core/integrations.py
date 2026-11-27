"""VIP: API-ключ (только чтение) и исходящие webhooks.

Ключ хранится только хэшем (показывается один раз). Webhook подписывается HMAC-SHA256 общим секретом;
адрес проверяется на SSRF и соединение идёт на проверенный IP, а не на повторно разрешённое имя.
"""
import hashlib
import hmac
import http.client
import ipaddress
import json
import logging
import secrets
import socket
import ssl
import time
import uuid
from datetime import timedelta
from urllib.parse import urlsplit

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from .models import ApiKey, Webhook
from .tiers import has_tier

logger = logging.getLogger(__name__)

KEY_PREFIX = "rk_"
SCHEME = b"api-key"
TOUCH_EVERY = timedelta(minutes=1)
WEBHOOK_TIMEOUT = 5
WEBHOOK_MAX_BODY = 64 * 1024
MAX_FAILURES = 20  # столько подряд неудач — и адрес отключается


# ---------- API-ключ ----------

def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_api_key(user):
    """Выпустить новый ключ (старый перестаёт работать). Возвращает (запись, открытый ключ) — открытый виден один раз."""
    raw = KEY_PREFIX + secrets.token_urlsafe(32)
    ApiKey.objects.filter(user=user).delete()
    return ApiKey.objects.create(user=user, prefix=raw[:10], key_hash=_hash(raw)), raw


class ApiKeyAuthentication(BaseAuthentication):
    """`Authorization: Api-Key <ключ>`. Годится только для выгрузок, а не для остального API."""

    def authenticate_header(self, request):
        return "Api-Key"

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts or parts[0].lower() != SCHEME:
            return None
        if len(parts) != 2:
            raise AuthenticationFailed("Неверный заголовок Authorization.")
        try:
            raw = parts[1].decode()
        except UnicodeError:
            raise AuthenticationFailed("Неверный ключ.") from None
        key = ApiKey.objects.select_related("user").filter(key_hash=_hash(raw)).first()
        if key is None or not key.user.is_active:
            raise AuthenticationFailed("Неверный ключ.")
        now = timezone.now()
        if key.last_used_at is None or now - key.last_used_at > TOUCH_EVERY:
            ApiKey.objects.filter(pk=key.pk).update(last_used_at=now)
        return key.user, key


# ---------- webhooks: адрес ----------

class UnsafeUrl(ValueError):
    pass


def resolve_public(url: str):
    """Проверяет адрес и возвращает (host, port, ip). Только https и только публичные IP — иначе UnsafeUrl."""
    parts = urlsplit(url.strip())
    if parts.scheme != "https" or not parts.hostname:
        raise UnsafeUrl("Нужен адрес https://…")
    if parts.username or parts.password:
        raise UnsafeUrl("Адрес не должен содержать логин и пароль.")
    port = parts.port or 443
    try:
        infos = socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
    except OSError:
        raise UnsafeUrl("Не удалось найти такой адрес.") from None
    ips = [ipaddress.ip_address(info[4][0]) for info in infos]
    if not ips or not all(ip.is_global for ip in ips):
        raise UnsafeUrl("Адрес ведёт во внутреннюю сеть — так нельзя.")
    return parts.hostname, port, str(ips[0])


class _PinnedConnection(http.client.HTTPSConnection):
    """HTTPS на заранее проверенный IP; имя хоста остаётся для SNI и проверки сертификата."""

    def __init__(self, host, port, ip, timeout):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class DeliveryError(Exception):
    pass


def sign(secret: str, timestamp: str, body: bytes) -> str:
    mac = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256)
    return "sha256=" + mac.hexdigest()


def post_event(url: str, secret: str, event: str, event_id: str, data: dict) -> int:
    """Одна попытка доставки. Возвращает HTTP-код; сетевые и 5xx/429 — DeliveryError (можно повторить)."""
    try:
        host, port, ip = resolve_public(url)
    except UnsafeUrl as exc:
        raise DeliveryError(str(exc)) from None
    body = json.dumps({"id": event_id, "event": event, "created_at": timezone.now().isoformat(), "data": data},
                      ensure_ascii=False).encode()
    if len(body) > WEBHOOK_MAX_BODY:
        raise DeliveryError("Слишком большое событие.")
    ts = str(int(time.time()))
    parts = urlsplit(url)
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    conn = _PinnedConnection(host, port, ip, WEBHOOK_TIMEOUT)
    try:
        conn.request("POST", path, body, {
            "Content-Type": "application/json", "User-Agent": "Arenda-Webhook/1",
            "X-Webhook-Event": event, "X-Webhook-Id": event_id, "X-Webhook-Timestamp": ts,
            "X-Webhook-Signature": sign(secret, ts, body),
        })
        status = conn.getresponse().status  # редиректы не выполняем: 3xx считаем ответом получателя
    except (OSError, http.client.HTTPException) as exc:
        raise DeliveryError(f"Нет связи: {type(exc).__name__}") from None
    finally:
        conn.close()
    if status >= 500 or status == 429:
        raise DeliveryError(f"Получатель ответил {status}")
    return status


def record_result(webhook, *, ok: bool, status=None, error=""):
    """Запомнить итог попытки; после MAX_FAILURES неудач подряд адрес отключается."""
    now = timezone.now()
    if ok:
        Webhook.objects.filter(pk=webhook.pk).update(last_attempt_at=now, last_status=status, last_error="", failures=0)
        return
    webhook.refresh_from_db()
    failures = webhook.failures + 1
    Webhook.objects.filter(pk=webhook.pk).update(
        last_attempt_at=now, last_status=status, last_error=error[:255], failures=failures,
        is_active=failures < MAX_FAILURES,
    )


def emit(user, event: str, data: dict):
    """Поставить событие в очередь, если у владельца VIP и включён webhook. Сбой здесь не должен ломать основное действие."""
    try:
        hook = Webhook.objects.filter(user=user, is_active=True).first()
        if hook is None or not has_tier(user, "vip"):
            return
        from .tasks import deliver_webhook

        deliver_webhook.delay(hook.pk, event, uuid.uuid4().hex, data)
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось поставить webhook %s в очередь", event)
