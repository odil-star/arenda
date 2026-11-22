"""Ограничения тарифа. Арендодатель без назначенного тарифа ограничений не имеет (как до тарифов)."""
from rest_framework.exceptions import ValidationError

from .models import Subscription


def ensure_can_add_property(user):
    """Бросает понятную ошибку, если тариф исчерпан. Срок оплаты здесь не проверяется — только лимит объектов."""
    from leasing.models import Property  # импорт здесь: leasing сам зависит от core

    # Вызывать внутри transaction.atomic(): строка подписки блокируется до сохранения объекта
    sub = Subscription.objects.select_for_update(of=("self",)).select_related("plan").filter(user=user).first()
    if sub is None or sub.plan.max_properties is None:
        return
    if Property.objects.filter(owner=user).count() >= sub.plan.max_properties:
        raise ValidationError({
            "detail": [
                f"Тариф «{sub.plan.name}» позволяет не более {sub.plan.max_properties} объектов. "
                "Чтобы добавить больше, свяжитесь с поддержкой."
            ]
        })
