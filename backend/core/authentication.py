"""JWT-аутентификация с режимом «просмотр от имени арендодателя».

Токен, выданный админом платформы для просмотра чужого аккаунта, содержит claim `imp`
(id админа). Такой токен принимается только для безопасных методов — любые изменения
запрещены, чтобы админ случайно (или намеренно) ничего не менял за арендодателя.
"""
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS
from rest_framework_simplejwt.authentication import JWTAuthentication

IMPERSONATION_CLAIM = "imp"


class ReadOnlyImpersonationJWTAuthentication(JWTAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        _user, token = result
        if token.get(IMPERSONATION_CLAIM) and request.method not in SAFE_METHODS:
            raise PermissionDenied("Режим просмотра: изменения запрещены.")
        return result


try:  # схема OpenAPI: наш класс — тот же Bearer JWT
    from drf_spectacular.extensions import OpenApiAuthenticationExtension

    class ReadOnlyImpersonationJWTScheme(OpenApiAuthenticationExtension):
        target_class = "core.authentication.ReadOnlyImpersonationJWTAuthentication"
        name = "jwtAuth"

        def get_security_definition(self, auto_schema):
            return {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
except ImportError:  # pragma: no cover
    pass
