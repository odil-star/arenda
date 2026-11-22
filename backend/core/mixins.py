from rest_framework import serializers


class OwnedQuerysetMixin:
    """Любой queryset вьюхи фильтруется по текущему пользователю: чужое = 404."""

    def get_queryset(self):
        return super().get_queryset().filter(owner=self.request.user)


class OwnedPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    """Внешний ключ принимает только объекты текущего владельца."""

    default_error_messages = {
        "required": "Обязательное поле.",
        "does_not_exist": "Объект не найден.",
        "incorrect_type": "Некорректное значение.",
        "null": "Поле не может быть пустым.",
    }

    def get_queryset(self):
        request = self.context.get("request")
        queryset = super().get_queryset()
        if request is None or not request.user.is_authenticated:
            return queryset.none()
        return queryset.filter(owner=request.user)
