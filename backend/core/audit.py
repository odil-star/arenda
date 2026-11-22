from .models import AuditLog


def log_action(owner, action, obj=None, actor=None, **details):
    """Записать действие в журнал. Вызывать внутри той же транзакции, что и само действие."""
    return AuditLog.objects.create(
        owner=owner,
        actor=actor,
        action=action,
        object_type=obj.__class__.__name__ if obj is not None else "",
        object_id=obj.pk if obj is not None else None,
        details=details,
    )
