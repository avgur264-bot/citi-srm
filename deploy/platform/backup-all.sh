#!/usr/bin/env bash
# Резервные копии баз ВСЕХ клиентов. Кладёт в ./backups/<дата>/<клиент>.db
# Безопасно для SQLite (копирует через .backup). Хранит последние 14 дней.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y-%m-%d_%H%M)"
DEST="$ROOT/backups/$STAMP"
mkdir -p "$DEST"

shopt -s nullglob
for d in "$ROOT"/clients/*/; do
  name="$(basename "$d")"
  db="$d/data/srm.db"
  [ -f "$db" ] || continue
  cp "$db" "$DEST/$name.db"
  echo "✓ $name → $DEST/$name.db"
done

# чистим старше 14 дней
find "$ROOT/backups" -maxdepth 1 -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true
echo "Готово. Копии: $DEST"
