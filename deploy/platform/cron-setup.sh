#!/usr/bin/env bash
# Включить ЕЖЕДНЕВНЫЙ авто-бэкап всех клиентов (cron). Запустить ОДИН раз на сервере под root.
#   bash /opt/citi-srm/deploy/platform/cron-setup.sh
# По умолчанию каждый день в 03:30. Хранит 14 последних копий (см. backup-all.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$ROOT/backup-all.sh"
TIME="${1:-30 3}"   # минута час, можно переопределить: bash cron-setup.sh "0 4"

chmod +x "$SCRIPT" 2>/dev/null || true
mkdir -p "$ROOT/backups"

# sqlite3 нужен для согласованных копий базы (иначе скрипт падает на cp)
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "→ Устанавливаю sqlite3…"
  apt-get update -qq && apt-get install -y -qq sqlite3 || echo "  (не удалось — копии будут через cp)"
fi

LINE="$TIME * * * $SCRIPT >> $ROOT/backups/cron.log 2>&1"
# добавляем в crontab root, удаляя прежнюю строку про backup-all (без дублей)
( crontab -l 2>/dev/null | grep -v "backup-all.sh" ; echo "$LINE" ) | crontab -

echo "✓ Авто-бэкап включён."
echo "  Расписание (минута час день месяц день_недели):"
crontab -l | grep "backup-all.sh"
echo "  Копии: $ROOT/backups/  ·  лог: $ROOT/backups/cron.log"
echo
echo "Проверить прямо сейчас:   bash $SCRIPT"
echo "Отключить авто-бэкап:     crontab -l | grep -v backup-all.sh | crontab -"
