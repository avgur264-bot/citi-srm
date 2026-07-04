#!/usr/bin/env bash
# Обновить программу у ВСЕХ клиентов разом (после доработок).
# Тянет свежий код из GitHub, пересобирает образ и перезапускает все
# клиентские приложения. Базы клиентов при этом не трогаются.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"          # …/deploy/platform
SRC="$(cd "$ROOT/../.." && pwd)"                # корень репозитория (там Dockerfile)

echo "→ Забираю свежий код из GitHub…"
# при неудаче pull (расхождение истории / грязное дерево) — ПРЕРЫВАЕМ, иначе соберём старый код молча
git -C "$SRC" pull --ff-only || { echo "✗ git pull не удался (расхождение/грязное дерево). Обновление прервано, код НЕ изменён."; exit 1; }

echo "→ Пересобираю образ (тег с датой + latest, чтобы был откат)…"
TAG="$(date +%Y%m%d-%H%M%S)"
docker build -t "citi-srm:$TAG" -t citi-srm:latest "$SRC" || { echo "✗ Сборка образа не удалась. Клиенты НЕ трогались (работают на прежнем образе)."; exit 1; }
echo "  Образ citi-srm:$TAG (и latest). Предыдущие теги можно посмотреть: docker images citi-srm"

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
