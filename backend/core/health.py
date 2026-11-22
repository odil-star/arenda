from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from django.core.cache import cache
from django.db import connection
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.response import Response


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@authentication_classes([])
@permission_classes([])
@throttle_classes([])
def health(request):
    """Проверка живости для балансировщика: БД и кэш. Подробности ошибок наружу не отдаём."""
    checks = {}
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        checks["database"] = "ok"
    except Exception:  # noqa: BLE001
        checks["database"] = "fail"
    try:
        cache.set("health", 1, 5)
        checks["cache"] = "ok" if cache.get("health") == 1 else "fail"
    except Exception:  # noqa: BLE001
        checks["cache"] = "fail"
    healthy = all(v == "ok" for v in checks.values())
    return Response({"status": "ok" if healthy else "fail", **checks}, status=200 if healthy else 503)
