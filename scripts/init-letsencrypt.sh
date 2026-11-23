#!/bin/sh
# Первый выпуск сертификата Let's Encrypt. Запускать один раз на сервере, из корня репозитория,
# когда DNS домена уже указывает на сервер, а порты 80 и 443 открыты.
# Дальше certbot продлевает сертификат сам, а nginx подхватывает его раз в 12 часов.
set -eu

if [ ! -f .env ]; then echo "Нет файла .env (скопируйте .env.example)"; exit 1; fi
set -a; . ./.env; set +a
: "${DOMAIN:?Задайте DOMAIN в .env}"
: "${LETSENCRYPT_EMAIL:?Задайте LETSENCRYPT_EMAIL в .env}"
: "${POSTGRES_PASSWORD:?Задайте POSTGRES_PASSWORD в .env}"

CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

echo "1/4 Временный самоподписанный сертификат (чтобы nginx смог стартовать)..."
docker compose run --rm --no-deps --entrypoint sh nginx -c \
  "mkdir -p $CERT_DIR && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
   -keyout $CERT_DIR/privkey.pem -out $CERT_DIR/fullchain.pem -subj /CN=localhost"

echo "2/4 Запуск стека..."
docker compose up -d --build

echo "3/4 Удаляю временный сертификат и запрашиваю настоящий..."
docker compose run --rm --no-deps --entrypoint sh nginx -c \
  "rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf"
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email --non-interactive

echo "4/4 Перезагрузка nginx..."
docker compose exec nginx nginx -s reload
echo "Готово: https://$DOMAIN"
