#!/usr/bin/env bash
# Обновить программу у ВСЕХ клиентов разом (после доработок).
# Тянет свежий код из GitHub, пересобирает образ и перезапускает все
# клиентские приложения. Базы клиентов при этом не трогаются.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"          # …/deploy/platform
SRC="$(cd "$ROOT/../.." && pwd)"                # корень репозитория (там Dockerfile)

echo "→ Забираю свежий код из GitHub…"
git -C "$SRC" pull --ff-only || echo "  (git pull пропущен — проверьте вручную)"

echo "→ Пересобираю образ citi-srm:latest…"
docker build -t citi-srm:latest "$SRC"

shopt -s nullglob
clients=("$ROOT"/clients/*/)
if [ ${#clients[@]} -eq 0 ]; then
  echo "Клиентов пока нет. Добавьте: $ROOT/new-client.sh <имя> <поддомен>"
  exit 0
fi

for d in "${clients[@]}"; do
  name="$(basename "$d")"
  echo "→ Обновляю клиента '$name'…"
  docker compose -f "$d/docker-compose.yml" up -d --force-recreate
done

echo
echo "✓ Обновлены все клиенты (${#clients[@]} шт.). Базы сохранены."
