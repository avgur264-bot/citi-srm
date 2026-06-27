#!/usr/bin/env bash
# Показать всех клиентов, их поддомены и статус приложения.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

shopt -s nullglob
clients=("$ROOT"/clients/*/)
if [ ${#clients[@]} -eq 0 ]; then
  echo "Клиентов пока нет."
  exit 0
fi

printf "%-16s %-32s %-12s %s\n" "КЛИЕНТ" "ПОДДОМЕН" "СТАТУС" "БАЗА (МБ)"
for d in "${clients[@]}"; do
  name="$(basename "$d")"
  site="$ROOT/proxy/sites/$name.caddy"
  domain="$( [ -f "$site" ] && head -1 "$site" | awk '{print $1}' || echo '—')"
  status="$(docker inspect -f '{{.State.Status}}' "srm-$name" 2>/dev/null || echo 'остановлен')"
  size="$(du -m "$d/data/srm.db" 2>/dev/null | awk '{print $1}' || echo 0)"
  printf "%-16s %-32s %-12s %s\n" "$name" "$domain" "$status" "$size"
done
