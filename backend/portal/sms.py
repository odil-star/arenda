"""SMS-бэкенды. Выбор — переменная окружения SMS_BACKEND (console | eskiz | locmem | путь.к.Классу)."""
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.cache import cache
from django.utils.module_loading import import_string

logger = logging.getLogger(__name__)


class SmsError(Exception):
    pass


class SmsBackend:
    def send(self, phone, text):
        raise NotImplementedError


class ConsoleSmsBackend(SmsBackend):
    """Dev: печатает сообщение (с кодом) в лог. В проде не использовать."""

    def send(self, phone, text):
        logger.warning("SMS -> %s: %s", phone, text)


class LocMemSmsBackend(SmsBackend):
    """Тесты: складывает сообщения в `outbox`."""

    outbox = []

    def send(self, phone, text):
        self.outbox.append((phone, text))


class EskizSmsBackend(SmsBackend):
    """Eskiz.uz: login (email, password) -> Bearer-токен; отправка на /api/message/sms/send.

    Токен живёт ~30 дней, кэшируется; при 401 обновляется один раз. Ошибки не глотаются:
    SmsError поднимается наверх, чтобы код входа не «терялся молча».
    """

    CACHE_KEY = "eskiz:token"

    def __init__(self):
        self.base = settings.ESKIZ_BASE_URL.rstrip("/")
        self.email = settings.ESKIZ_EMAIL
        self.password = settings.ESKIZ_PASSWORD
        self.sender = settings.ESKIZ_FROM

    def _request(self, path, fields, token=None):
        data = urllib.parse.urlencode(fields).encode()
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        request = urllib.request.Request(self.base + path, data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise _Unauthorized() from None
            raise SmsError(f"Eskiz вернул {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            raise SmsError(f"Нет связи с Eskiz: {type(exc).__name__}") from None

    def _token(self, refresh=False):
        token = None if refresh else cache.get(self.CACHE_KEY)
        if token:
            return token
        if not (self.email and self.password):
            raise SmsError("ESKIZ_EMAIL / ESKIZ_PASSWORD не заданы")
        try:
            body = self._request("/api/auth/login", {"email": self.email, "password": self.password})
        except _Unauthorized:
            raise SmsError("Eskiz: неверный логин или пароль") from None
        token = (body.get("data") or {}).get("token")
        if not token:
            raise SmsError("Eskiz не вернул токен")
        cache.set(self.CACHE_KEY, token, 25 * 24 * 3600)
        return token

    def send(self, phone, text):
        fields = {"mobile_phone": phone.lstrip("+"), "message": text, "from": self.sender}
        try:
            self._request("/api/message/sms/send", fields, self._token())
        except _Unauthorized:
            try:
                self._request("/api/message/sms/send", fields, self._token(refresh=True))
            except _Unauthorized:
                raise SmsError("Eskiz отклонил токен") from None


class _Unauthorized(Exception):
    pass


_ALIASES = {
    "console": ConsoleSmsBackend,
    "locmem": LocMemSmsBackend,
    "eskiz": EskizSmsBackend,
}


def get_sms_backend():
    name = settings.SMS_BACKEND
    cls = _ALIASES.get(name) or import_string(name)
    return cls()
