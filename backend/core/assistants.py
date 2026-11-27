"""VIP: помощники арендодателя (бухгалтер, управляющий) с ограниченным доступом.

Помощник — отдельный пользователь со своим email и паролем. При входе его запросы выполняются «от имени владельца»
(request.user = владелец, данные те же), но только в пределах белого списка путей своей роли. Всё, чего нет в списке,
запрещено: профиль и пароль владельца, тариф, интеграции, бланк, журнал действий, чат поддержки, управление
помощниками. Удаление запрещено обеим ролям.
"""
from contextvars import ContextVar

from rest_framework.permissions import SAFE_METHODS

from .models import Assistant

ACCOUNTANT_READ = (
    "properties", "tenants", "leases", "payments", "dashboard", "reports", "expenses", "meter-readings",
    "receipts", "announcements",
)
MANAGER_READ = ACCOUNTANT_READ + ("documents", "lease-media", "repairs", "lease-requests", "tenant-meter-readings")
MANAGER_WRITE = (
    "properties", "tenants", "leases", "payments", "receipts", "documents", "lease-media", "repairs",
    "lease-requests", "tenant-meter-readings", "expenses", "meter-readings",
)

READ = {Assistant.Role.ACCOUNTANT: ACCOUNTANT_READ, Assistant.Role.MANAGER: MANAGER_READ}
WRITE = {Assistant.Role.ACCOUNTANT: ("expenses",), Assistant.Role.MANAGER: MANAGER_WRITE}

_current: ContextVar = ContextVar("current_assistant", default=None)


def allowed(role: str, method: str, path: str) -> bool:
    """Можно ли помощнику с ролью `role` вызвать `method` по `path` (путь без «/api/»). Всё неописанное — нельзя."""
    first = path.split("/", 1)[0]
    if first == "me":  # только собственный профиль помощника; пароль и привязки — нет
        return method in SAFE_METHODS and path == "me/"
    if method in SAFE_METHODS:
        return first in READ.get(role, ())
    if method == "DELETE":
        return False
    return first in WRITE.get(role, ())


def set_current(assistant) -> None:
    _current.set(assistant)


def current_assistant():
    return _current.get()
