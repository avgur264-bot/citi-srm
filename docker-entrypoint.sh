#!/bin/sh
# Запуск приложения БЕЗ прав root.
# Тома (база и файлы документов) монтируются с хоста и могут принадлежать root —
# поэтому сначала (от root) выставляем владельца node, затем сбрасываем права и запускаем сервер.
set -e

for d in /app/data /app/files; do
  [ -d "$d" ] || mkdir -p "$d" 2>/dev/null || true
  chown -R node:node "$d" 2>/dev/null || true
done

# если по какой-то причине мы уже не root — просто запускаем как есть
if [ "$(id -u)" = "0" ]; then
  exec su-exec node:node "$@"
fi
exec "$@"
