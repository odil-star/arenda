from .base import *  # noqa: F401,F403
from .base import REST_FRAMEWORK, env

DEBUG = False
# Без этих переменных приложение не стартует (ImproperlyConfigured) — это намеренно.
SECRET_KEY = env("SECRET_KEY")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS")

CONN_MAX_AGE = 60
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=31536000)
SECURE_CONTENT_TYPE_NOSNIFF = True
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# За nginx (см. docker-compose) реальный IP клиента — в X-Forwarded-For. Если оставить 0, весь трафик
# выглядит как один IP, и IP-лимиты (SMS, приглашения) блокируют всех сразу. Без прокси задайте NUM_PROXIES=0.
REST_FRAMEWORK = {**REST_FRAMEWORK, "NUM_PROXIES": env.int("NUM_PROXIES", default=1)}

# Мониторинг ошибок: включается, только если задан SENTRY_DSN.
if env("SENTRY_DSN", default=""):
    import sentry_sdk

    sentry_sdk.init(
        dsn=env("SENTRY_DSN"),
        environment=env("SENTRY_ENVIRONMENT", default="production"),
        traces_sample_rate=env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.0),
        send_default_pii=False,  # паспорта и телефоны в Sentry не отправляем
    )
