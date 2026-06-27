#!/usr/bin/env bash
# Обновление СИТИ SRM на сервере: забрать свежий код и пересобрать контейнер.
# Данные базы (./data) при этом не трогаются.
set -euo pipefail

cd "$(dirname "$0")"

echo "→ Получаю свежий код из GitHub..."
git -C .. pull --ff-only

echo "→ Пересобираю и перезапускаю..."
docker compose up -d --build

echo "→ Убираю старые образы..."
docker image prune -f >/dev/null 2>&1 || true

echo "→ Готово. Текущий статус:"
docker compose ps
