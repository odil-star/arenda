"""Web Push: отправка уведомлений в браузеры и установленные PWA."""
import json
import logging

from django.conf import settings
from django.core.cache import cache

from .models import PushSubscription

logger = logging.getLogger(__name__)

try:  # зависимость необязательна: без неё push просто выключен
    from pywebpush import WebPushException, webpush
except ImportError:  # pragma: no cover
    webpush = WebPushException = None


def push_enabled():
    return bool(webpush and settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


def send_push(user, title, body, url="/", dedupe_key=None):
    """Отправить уведомление на все устройства пользователя; вернуть число доставленных.

    `dedupe_key` защищает от дублей при повторном запуске задачи (хранится сутки).
    Сбои сети не пробрасываются; мёртвые подписки (404/410) удаляются.
    """
    if not push_enabled() or user is None:
        return 0
    if dedupe_key and not cache.add(f"push:{dedupe_key}", 1, timeout=24 * 3600):
        return 0
    payload = json.dumps({"title": title, "body": body, "url": url}, ensure_ascii=False)
    sent = 0
    for sub in PushSubscription.objects.filter(user=user):
        try:
            webpush(
                subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=payload, vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_CONTACT}, ttl=24 * 3600,
            )
            sent += 1
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                sub.delete()
            else:
                logger.warning("Push не доставлен (%s): %s", status, exc)
        except Exception:  # noqa: BLE001 — канал не должен ломать основную логику
            logger.exception("Ошибка отправки push")
    return sent
