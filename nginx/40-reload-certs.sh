#!/bin/sh
# Фоновый цикл: подхватывает обновлённые сертификаты Let's Encrypt без перезапуска контейнера.
( while :; do sleep 12h; nginx -s reload; done ) &
