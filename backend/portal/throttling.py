"""Фиксированные окна по IP / ключу на общем кэше (в проде — Redis)."""
from django.core.cache import cache
from rest_framework.throttling import BaseThrottle


def hit(key, limit, window):
    """Регистрирует обращение; True — если лимит ещё не превышен."""
    cache_key = f"rl:{key}"
    if cache.add(cache_key, 1, window):
        return True
    try:
        return cache.incr(cache_key) <= limit
    except ValueError:  # ключ истёк между add и incr
        cache.set(cache_key, 1, window)
        return True


class IPWindowThrottle(BaseThrottle):
    scope = ""
    limit = 10
    window = 60  # секунд

    def allow_request(self, request, view):
        return hit(f"{self.scope}:{self.get_ident(request)}", self.limit, self.window)


class InvitePreviewThrottle(IPWindowThrottle):
    scope, limit, window = "invite_preview", 30, 60


class InviteAcceptThrottle(IPWindowThrottle):
    scope, limit, window = "invite_accept", 10, 60


class PhoneRequestIPThrottle(IPWindowThrottle):
    scope, limit, window = "phone_request", 3, 600


class PhoneVerifyThrottle(IPWindowThrottle):
    scope, limit, window = "phone_verify", 20, 600
