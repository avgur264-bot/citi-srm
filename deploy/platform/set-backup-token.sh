#!/usr/bin/env bash
# Включить выгрузку бэкапа по токену для клиента (GET /api/backup?token=...).
# Нужен, чтобы сервер клиента (например домашний) сам забирал бэкап по расписанию.
#
# Использование:
#   ./set-backup-token.sh <клиент> [токен]
#   ./set-backup-token.sh zimin            # токен сгенерируется автоматически
#   ./set-backup-token.sh zimin МОЙ_ТОКЕН  # задать свой
#
# Токен вписывается в окружение клиента (clients/<имя>/docker-compose.yml) — в БД и браузер не попадает.
set -euo pipefail

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "Использование: $0 <клиент> [токен]"
  echo "Пример:        $0 zimin"
  exit 1
fi
TOKEN="${2:-$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')}"   # 64 hex-символа

printf '%s' "$TOKEN" | grep -qE '^[A-Za-z0-9_.:-]{20,200}$' \
  || { echo "Ошибка: токен должен быть 20–200 символов (буквы/цифры/._:-)."; exit 1; }

ROOT="$(cd "$(dirname "$0")" && pwd)"          # …/deploy/platform
CF="$ROOT/clients/$NAME/docker-compose.yml"
[ -f "$CF" ] || { echo "Ошибка: клиент '$NAME' не найден ($CF)."; exit 1; }

BAK="$CF.bak-$(date +%Y%m%d-%H%M%S)"
cp "$CF" "$BAK"
# Убираем прежнюю строку токена и вписываем заново сразу после 'environment:'.
awk -v tok="$TOKEN" '
  /BACKUP_TOKEN/ { next }
  { print }
  /^[[:space:]]*environment:[[:space:]]*$/ && !done {
    print "      - BACKUP_TOKEN=" tok
    done=1
  }
' "$BAK" > "$CF"

if ! grep -q 'BACKUP_TOKEN=' "$CF"; then
  cp "$BAK" "$CF"
  echo "Ошибка: не нашёл блок 'environment:' в $CF — токен НЕ вписан, файл восстановлен."
  exit 1
fi

echo "→ Пересоздаю контейнер клиента '$NAME'…"
docker compose -f "$CF" up -d

DOMAIN="$(grep -oE '[a-z0-9-]+\.citisrm\.ru' "$ROOT/proxy/sites/$NAME.caddy" 2>/dev/null | head -1 || true)"
[ -n "$DOMAIN" ] || DOMAIN="$NAME.citisrm.ru"

echo
echo "✓ Выгрузка бэкапа включена для клиента '$NAME'."
echo
echo "Ссылка для скачивания бэкапа (СЕКРЕТНАЯ — не публиковать):"
echo "  https://$DOMAIN/api/backup?token=$TOKEN"
echo
echo "Строка для cron на сервере клиента (ежедневно в 03:00, хранение 30 дней):"
echo "  0 3 * * * curl -fsS \"https://$DOMAIN/api/backup?token=$TOKEN\" -o /backup/citi-srm-\$(date +\\%F).json && find /backup -name 'citi-srm-*.json' -mtime +30 -delete"
echo
echo "Проверить прямо сейчас:"
echo "  curl -fsS \"https://$DOMAIN/api/backup?token=$TOKEN\" | head -c 200; echo"
