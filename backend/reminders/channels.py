import json
import urllib.error
import urllib.request

from django.conf import settings
from django.utils.module_loading import import_string


class SendError(Exception):
    pass


class TelegramSender:
    """Отправка через Bot API (синхронно — для Celery). Токен только из окружения."""

    def send(self, chat_id, text, reply_markup=None):
        token = settings.TELEGRAM_BOT_TOKEN
        if not token:
            raise SendError("TELEGRAM_BOT_TOKEN не задан")
        payload = {"chat_id": chat_id, "text": text}
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup  # inline-кнопки: {"inline_keyboard": [[...]]}
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                if response.status != 200:
                    raise SendError(f"Telegram вернул {response.status}")
        except urllib.error.HTTPError as exc:
            raise SendError(f"Telegram вернул {exc.code}") from None  # без токена в тексте ошибки
        except (urllib.error.URLError, TimeoutError) as exc:
            raise SendError(f"Нет связи с Telegram: {type(exc).__name__}") from None


_username_cache = {}


def bot_username():
    """Имя бота: из TELEGRAM_BOT_USERNAME, иначе один раз спрашиваем у Telegram (getMe) и запоминаем."""
    if settings.TELEGRAM_BOT_USERNAME:
        return settings.TELEGRAM_BOT_USERNAME
    token = settings.TELEGRAM_BOT_TOKEN
    if not token:
        return ""
    if token not in _username_cache:
        try:
            with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/getMe", timeout=5) as response:
                _username_cache[token] = (json.load(response).get("result") or {}).get("username", "")
        except Exception:  # noqa: BLE001 — без сети просто не даём ссылку, ручной код остаётся
            return ""
    return _username_cache[token]


def bot_link(code):
    """Ссылка t.me/<бот>?start=<код>: по ней бот привязывает аккаунт без ввода кода."""
    username = bot_username()
    return f"https://t.me/{username}?start={code}" if username and code else None


def get_sender():
    return import_string(settings.TELEGRAM_SENDER)()
