#!/usr/bin/env bash
# Ежедневный бэкап базы СИТИ SRM. Делает согласованную копию даже при работающем сервере.
# Хранит последние 14 копий. Запускается по расписанию (cron) — см. DEPLOY-VPS.md.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
DB="$DIR/data/srm.db"
DEST="$DIR/backups"
STAMP="$(date +%Y-%m-%d_%H%M)"

mkdir -p "$DEST"

if [ ! -f "$DB" ]; then
  echo "[$(date)] База не найдена: $DB" >&2
  exit 1
fi

# .backup делает целостную копию с учётом WAL (требуется пакет sqlite3)
sqlite3 "$DB" ".backup '$DEST/srm-$STAMP.db'"

# Оставляем только 14 последних бэкапов
ls -1t "$DEST"/srm-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f

echo "[$(date)] Бэкап готов: $DEST/srm-$STAMP.db"
