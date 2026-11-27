"""JWT-аутентификация с режимом «просмотр от имени арендодателя».

Токен, выданный админом платформы для просмотра чужого аккаунта, содержит claim `imp`
(id админа). Такой токен принимается только для безопасных методов — любые изменения
запрещены, чтобы админ случайно (или намеренно) ничего не менял за арендодателя.
"""
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS
from rest_framework_simplejwt.authentication import JWTAuthentication

from . import assistants
from .models import Assistant
from .tiers import has_tier

IMPERSONATION_CLAIM = "imp"


class ReadOnlyImpersonationJWTAuthentication(JWTAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        assistants.set_current(None)  # значение не должно «протекать» из прошлого запроса в том же потоке
        if result is None:
            return None
        user, token = result
        if token.get(IMPERSONATION_CLAIM) and request.method not in SAFE_METHODS:
            raise PermissionDenied("Режим просмотра: изменения запрещены.")
        link = Assistant.objects.select_related("owner").filter(user=user).first()
        if link is None:
            return result
        return self._as_owner(request, link, token)

    @staticmethod
    def _as_owner(request, link, token):
        """Помощник: запрос идёт от имени владельца, но только по разрешённым его роли путям."""
        owner = link.owner
        if not link.is_active or not owner.is_active:
            raise PermissionDenied("Доступ помощника отключён.")
        if not has_tier(owner, "vip"):
            raise PermissionDenied("Тариф владельца больше не включает помощников.")
        path = request.path.removeprefix("/api/")
        if not assistants.allowed(link.role, request.method, path):
            raise PermissionDenied("Для вашей роли это действие недоступно.")
        assistants.set_current(link)
        request._request.assistant = link  # для MeView и вьюх, которым важно, кто на самом деле действует
        return owner, token


try:  # схема OpenAPI: наш класс — тот же Bearer JWT
    from drf_spectacular.extensions import OpenApiAuthenticationExtension

    class ReadOnlyImpersonationJWTScheme(OpenApiAuthenticationExtension):
        target_class = "core.authentication.ReadOnlyImpersonationJWTAuthentication"
        name = "jwtAuth"

        def get_security_definition(self, auto_schema):
            return {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
except ImportError:  # pragma: no cover
    pass
