#!/bin/sh
# Печатает случайные значения для боевого окружения. Ничего не записывает в файлы.
set -eu
PY="$(command -v python3 || command -v python)"
echo "# Корневой .env:"
echo "POSTGRES_PASSWORD=$($PY -c 'import secrets; print(secrets.token_hex(24))')"
echo
echo "# backend/.env:"
echo "SECRET_KEY=$($PY -c 'import secrets; print(secrets.token_urlsafe(64))')"
