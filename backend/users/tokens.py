from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken


def revoke_user_tokens(user):
    """Отзывает все выданные refresh-токены пользователя (после смены/сброса пароля).

    Уже выданные access-токены живут до истечения (30 минут)."""
    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)
