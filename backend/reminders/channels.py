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


def get_sender():
    return import_string(settings.TELEGRAM_SENDER)()
