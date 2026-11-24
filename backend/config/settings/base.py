"""Общие настройки. Все секреты и адреса — только из окружения."""
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlparse

import environ
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
if (BASE_DIR / ".env").exists():
    environ.Env.read_env(BASE_DIR / ".env")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    "core",
    "users",
    "leasing",
    "reminders",
    "billing",
    "finance",
    "portal",
    "support",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# PostgreSQL по умолчанию; любой другой движок — через DATABASE_URL.
DATABASES = {
    "default": env.db("DATABASE_URL", default="postgres://rent:rent@localhost:5432/rent")
}

AUTH_USER_MODEL = "users.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "ru"
TIME_ZONE = "Asia/Tashkent"
USE_I18N = True
USE_TZ = True  # в БД даты-время хранятся в UTC

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# Файлы: S3-совместимое хранилище (R2/MinIO), если задан бакет; иначе локальный диск.
_default_storage = {"BACKEND": "django.core.files.storage.FileSystemStorage"}
if env("AWS_STORAGE_BUCKET_NAME", default=""):
    _default_storage = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": env("AWS_STORAGE_BUCKET_NAME"),
            "access_key": env("AWS_ACCESS_KEY_ID"),
            "secret_key": env("AWS_SECRET_ACCESS_KEY"),
            "endpoint_url": env("AWS_S3_ENDPOINT_URL", default=None),
            "region_name": env("AWS_S3_REGION_NAME", default=None),
            "default_acl": None,
            "querystring_auth": True,  # приватные файлы отдаются по подписанным ссылкам
            "querystring_expire": 300,
        },
    }
STORAGES = {
    "default": _default_storage,
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

# Кэш нужен для троттлинга: в проде общий Redis, иначе локальная память процесса.
if env("REDIS_URL", default=""):
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": env("REDIS_URL"),
        }
    }
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# Кабинет жильца
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:5173").rstrip("/")
SMS_BACKEND = env("SMS_BACKEND", default="console")  # console | eskiz | locmem | dotted.path
ESKIZ_EMAIL = env("ESKIZ_EMAIL", default="")
ESKIZ_PASSWORD = env("ESKIZ_PASSWORD", default="")
ESKIZ_FROM = env("ESKIZ_FROM", default="4546")
ESKIZ_BASE_URL = env("ESKIZ_BASE_URL", default="https://notify.eskiz.uz")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "core.authentication.ReadOnlyImpersonationJWTAuthentication",
    ),
    # По умолчанию эндпоинты — только для арендодателя; жильцам и публичным вьюхам права задаются явно.
    "DEFAULT_PERMISSION_CLASSES": ("core.permissions.IsLandlord",),
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardPagination",
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_RATES": {
        "auth": env("AUTH_THROTTLE_RATE", default="10/min"),
        # выгрузки ПДн и вход «как арендодатель» (на пользователя)
        "admin_sensitive": env("ADMIN_SENSITIVE_THROTTLE_RATE", default="60/hour"),
    },
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "NUM_PROXIES": env.int("NUM_PROXIES", default=0),
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    # «Не выходить из аккаунта»: каждый refresh выдаёт новый refresh на 90 дней,
    # так что активный пользователь остаётся в системе, а вышедший из обихода — разлогинивается.
    "REFRESH_TOKEN_LIFETIME": timedelta(days=90),
    "ROTATE_REFRESH_TOKENS": True,
    # Использованный refresh отзывается; при смене пароля отзываются все (users.tokens.revoke_user_tokens).
    "BLACKLIST_AFTER_ROTATION": True,
}

CORS_ALLOWED_ORIGINS = env.list("CORS_ORIGINS", default=[])

# Celery
CELERY_BROKER_URL = env("REDIS_URL", default="redis://localhost:6379/0")
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_ALWAYS_EAGER = env.bool("CELERY_EAGER", default=False)
CELERY_BEAT_SCHEDULE = {
    "daily-reminders": {
        "task": "reminders.tasks.send_daily_reminders",
        "schedule": crontab(hour=9, minute=0),
    },
    "end-expired-leases": {
        "task": "leasing.tasks.end_expired_leases",
        "schedule": crontab(hour=0, minute=10),
    },
    "admin-problem-payments-alert": {
        "task": "core.tasks.check_problem_payments",
        "schedule": crontab(minute=5),  # каждый час
    },
    "notify-saved-searches": {
        "task": "leasing.tasks.notify_saved_searches",
        "schedule": crontab(minute="*/30"),
    },
    "prune-webhook-logs": {
        "task": "core.tasks.prune_webhook_logs",
        "schedule": crontab(hour=3, minute=30),
    },
}
# Оповещение админов: сколько проблемных оплат за сутки считать тревогой (0 — выключено)
ADMIN_ALERT_PROBLEM_THRESHOLD = env.int("ADMIN_ALERT_PROBLEM_THRESHOLD", default=3)

# Напоминания / Telegram
TELEGRAM_BOT_TOKEN = env("TELEGRAM_BOT_TOKEN", default="")
TELEGRAM_BOT_USERNAME = env("TELEGRAM_BOT_USERNAME", default="").lstrip("@")  # для ссылки «Сообщить о новых»
TELEGRAM_SENDER = "reminders.channels.TelegramSender"
REMINDER_DAYS_BEFORE = 3
REMINDER_OVERDUE_EVERY_DAYS = 3

# Web Push (VAPID). Ключи: python manage.py generate_vapid. Пусто — push выключен.
VAPID_PUBLIC_KEY = env("VAPID_PUBLIC_KEY", default="")
VAPID_PRIVATE_KEY = env("VAPID_PRIVATE_KEY", default="")
VAPID_CONTACT = env("VAPID_CONTACT", default="mailto:admin@example.com")

# Вход по отпечатку / Face ID (WebAuthn). RP_ID — домен сайта без порта; по умолчанию берётся из FRONTEND_URL.
WEBAUTHN_RP_ID = env("WEBAUTHN_RP_ID", default=urlparse(FRONTEND_URL).hostname or "localhost")
WEBAUTHN_RP_NAME = env("WEBAUTHN_RP_NAME", default="Arenda")
WEBAUTHN_ORIGINS = env.list("WEBAUTHN_ORIGINS", default=[FRONTEND_URL])

# Платёжные провайдеры
PAYME_MERCHANT_ID = env("PAYME_MERCHANT_ID", default="")
PAYME_KEY = env("PAYME_KEY", default="")
PAYME_CHECKOUT_URL = env("PAYME_CHECKOUT_URL", default="https://checkout.paycom.uz")
CLICK_SERVICE_ID = env("CLICK_SERVICE_ID", default="")
CLICK_MERCHANT_ID = env("CLICK_MERCHANT_ID", default="")
CLICK_SECRET_KEY = env("CLICK_SECRET_KEY", default="")

# Загрузка файлов
UPLOAD_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
UPLOAD_MAX_PHOTO_BYTES = 5 * 1024 * 1024
# Фото и видео состояния квартиры (договор)
UPLOAD_MAX_MEDIA_PHOTO_BYTES = 15 * 1024 * 1024
UPLOAD_MAX_MEDIA_VIDEO_BYTES = 100 * 1024 * 1024
LEASE_MEDIA_MAX_FILES = 40
DATA_UPLOAD_MAX_MEMORY_SIZE = 12 * 1024 * 1024

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"std": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "std"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Управление арендой недвижимости",
    "DESCRIPTION": "REST API для арендодателей и жильцов. Авторизация: Bearer JWT.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}
# Документацию API в проде по умолчанию не публикуем.
API_DOCS_ENABLED = env.bool("API_DOCS_ENABLED", default=False)

# Почта (восстановление пароля). По умолчанию письма печатаются в консоль.
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=25)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="noreply@localhost")
