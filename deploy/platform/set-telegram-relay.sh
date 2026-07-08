#!/usr/bin/env bash
# Задать адрес relay для Telegram Bot API у клиента (обход блокировки api.telegram.org на рос.
# хостинге) и пересоздать только его контейнер. Сервер будет ходить в Telegram через этот адрес.
# Использование:
#   ./set-telegram-relay.sh <клиент> <URL_relay>
#   ./set-telegram-relay.sh zimin https://tg-relay.avgur264.workers.dev
# Чтобы вернуть официальный адрес (убрать relay): ./set-telegram-relay.sh <клиент> off
set -euo pipefail

NAME="${1:-}"; URL="${2:-}"
if [ -z "$NAME" ] || [ -z "$URL" ]; then
  echo "Использование: $0 <клиент> <URL_relay|off>"
  echo "Пример:        $0 zimin https://tg-relay.avgur264.workers.dev"
  exit 1
fi
ROOT="$(cd "$(dirname "$0")" && pwd)"          # …/deploy/platform
CF="$ROOT/clients/$NAME/docker-compose.yml"
[ -f "$CF" ] || { echo "Ошибка: клиент '$NAME' не найден ($CF)."; exit 1; }

BAK="$CF.bak-$(date +%Y%m%d-%H%M%S)"
cp "$CF" "$BAK"

if [ "$URL" = "off" ]; then
  awk '/TELEGRAM_API_BASE/ { next } { print }' "$BAK" > "$CF"
  echo "→ Убрал relay у '$NAME' (вернул официальный api.telegram.org)."
else
  URL="${URL%/}"   # убрать хвостовой '/'
  printf '%s' "$URL" | grep -qE '^https://[^[:space:]]+$' \
    || { echo "Ошибка: адрес relay должен начинаться с https:// и без пробелов. Получено: $URL"; rm -f "$BAK"; exit 1; }
  awk -v url="$URL" '
    /TELEGRAM_API_BASE/ { next }
    { print }
    /^[[:space:]]*environment:[[:space:]]*$/ && !done {
      print "      - TELEGRAM_API_BASE=" url
      done=1
    }
  ' "$BAK" > "$CF"
  if ! grep -q 'TELEGRAM_API_BASE=' "$CF"; then
    cp "$BAK" "$CF"
    echo "Ошибка: не нашёл блок 'environment:' в $CF — не вписано, файл восстановлен."
    exit 1
  fi
  echo "→ Relay задан для '$NAME': $URL"
fi

echo "→ Пересоздаю контейнер клиента '$NAME'…"
docker compose -f "$CF" up -d
echo
echo "✓ Готово. Дальше: на сайте клиента → Настройки → «📨 Уведомления в Telegram» → «Сохранить и отправить тест»."
