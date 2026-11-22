#!/bin/sh
# Резервная копия БД и файлов. Запуск на сервере с docker compose, например раз в сутки из cron:
#   0 3 * * * cd /srv/rent && ./scripts/backup.sh /srv/backups
# Хранит последние 14 копий. Копии содержат персональные данные — держите их вне репозитория и шифруйте.
set -eu
DEST="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$DEST/db-$STAMP.sql.gz"
docker compose exec -T django tar -C /app -czf - media > "$DEST/media-$STAMP.tar.gz"
ls -1t "$DEST"/db-*.sql.gz | tail -n +15 | xargs -r rm --
ls -1t "$DEST"/media-*.tar.gz | tail -n +15 | xargs -r rm --
echo "OK: $DEST/db-$STAMP.sql.gz, $DEST/media-$STAMP.tar.gz"
# Восстановление БД:  gunzip -c db-XXXX.sql.gz | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
