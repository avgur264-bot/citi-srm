#!/usr/bin/env bash
# Резервные копии ВСЕХ клиентов: база (через sqlite .backup) + файлы документов.
# Кладёт в ./backups/<дата>/<клиент>.db и <клиент>-files.tar.gz. Хранит последние 14 дней.
set -euo pipefail
umask 077   # копии (хэши паролей, токены, перс. данные) — доступны только root
ROOT="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y-%m-%d_%H%M)"
DEST="$ROOT/backups/$STAMP"
mkdir -p "$DEST"

shopt -s nullglob
for d in "$ROOT"/clients/*/; do
  name="$(basename "$d")"
  db="$d/data/srm.db"
  if [ -f "$db" ]; then
    # согласованная копия SQLite (через .backup, иначе обычное копирование)
    sqlite3 "$db" ".backup '$DEST/$name.db'" 2>/dev/null || cp "$db" "$DEST/$name.db"
    echo "✓ $name (база) → $DEST/$name.db"
  fi
  if [ -d "$d/files" ] && [ -n "$(ls -A "$d/files" 2>/dev/null)" ]; then
    tar -czf "$DEST/$name-files.tar.gz" -C "$d" files 2>/dev/null && echo "✓ $name (документы) → $DEST/$name-files.tar.gz"
  fi
done

# чистим старше 14 дней
find "$ROOT/backups" -maxdepth 1 -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true
echo "Готово. Копии: $DEST"
