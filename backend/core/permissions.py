from rest_framework.permissions import BasePermission


def user_role(user):
    """Роль пользователя; пользователь без профиля считается арендодателем (обратная совместимость)."""
    profile = getattr(user, "profile", None)
    return profile.role if profile is not None else "landlord"


class IsLandlord(BasePermission):
    message = "Доступно только арендодателю."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user_role(user) == "landlord")


class IsTenantRole(BasePermission):
    message = "Доступно только жильцу."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user_role(user) == "tenant")
