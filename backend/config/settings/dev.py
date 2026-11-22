from .base import *  # noqa: F401,F403
from .base import BASE_DIR, env

DEBUG = env.bool("DEBUG", default=True)
SECRET_KEY = env("SECRET_KEY", default="dev-insecure-change-me")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1", "testserver"])
CORS_ALLOWED_ORIGINS = env.list("CORS_ORIGINS", default=["http://localhost:5173"])

import sys  # noqa: E402

if "test" in sys.argv:
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]  # быстрые тесты
    LOGGING = {"version": 1, "disable_existing_loggers": True}

API_DOCS_ENABLED = env.bool("API_DOCS_ENABLED", default=True)

# Локально работаем «из коробки» на SQLite; PostgreSQL — через DATABASE_URL (в проде обязателен).
DATABASES = {"default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}")}
