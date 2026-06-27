#!/usr/bin/env bash
# Первичная настройка платформы СИТИ SRM (один раз).
# Создаёт общую сеть, собирает образ приложения и запускает привратник.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"          # …/deploy/platform
SRC="$(cd "$ROOT/../.." && pwd)"                # …/server-app (там Dockerfile)

echo "→ Создаю общую сеть srmnet (если ещё нет)…"
docker network create srmnet 2>/dev/null && echo "  сеть создана" || echo "  сеть уже есть"

echo "→ Собираю образ приложения citi-srm:latest…"
docker build -t citi-srm:latest "$SRC"

echo "→ Готовлю папку маршрутов и запускаю привратник…"
mkdir -p "$ROOT/proxy/sites"
# Заглушка, чтобы Caddy стартовал даже без клиентов (отвечает на запросы по IP).
if [ ! -f "$ROOT/proxy/sites/_default.caddy" ]; then
  cat > "$ROOT/proxy/sites/_default.caddy" <<'EOF'
:80 {
	respond "СИТИ SRM — платформа работает. Клиентские кабинеты — на своих поддоменах." 200
}
EOF
fi

docker compose -f "$ROOT/proxy/docker-compose.yml" up -d

echo
echo "✓ Платформа готова. Добавляйте клиентов командой:"
echo "    $ROOT/new-client.sh <имя> <поддомен>"
echo "  пример:"
echo "    $ROOT/new-client.sh demo demo.citisrm.ru"
