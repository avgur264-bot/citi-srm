#!/usr/bin/env bash
# Добавить нового клиента СИТИ SRM. У каждого — своё приложение и своя база
# (полная изоляция данных) на своём поддомене с бесплатным HTTPS.
#
# Использование:
#   ./new-client.sh <имя> <поддомен>
#   ./new-client.sh demo demo.citisrm.ru
set -euo pipefail

NAME="${1:-}"; DOMAIN="${2:-}"
if [ -z "$NAME" ] || [ -z "$DOMAIN" ]; then
  echo "Использование: $0 <имя> <поддомен>"
  echo "Пример:        $0 client1 client1.citisrm.ru"
  exit 1
fi
# Имя — только латиница/цифры/дефис (используется в имени контейнера и папке).
if ! echo "$NAME" | grep -qE '^[a-z0-9-]+$'; then
  echo "Ошибка: имя клиента — только маленькие латинские буквы, цифры и дефис (например client1)."
  exit 1
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"          # …/deploy/platform
SRC="$(cd "$ROOT/../.." && pwd)"                # …/server-app
CDIR="$ROOT/clients/$NAME"

if [ -d "$CDIR" ]; then
  echo "Клиент '$NAME' уже существует ($CDIR). Для обновления используйте update-all.sh."
  exit 1
fi

echo "→ Обновляю образ приложения citi-srm:latest…"
docker build -t citi-srm:latest "$SRC" >/dev/null

echo "→ Создаю изолированное приложение и базу для клиента '$NAME'…"
mkdir -p "$CDIR/data"
cat > "$CDIR/docker-compose.yml" <<EOF
# Приложение клиента «$NAME». База — в ./data/srm.db (только для этого клиента).
services:
  app:
    image: citi-srm:latest
    container_name: srm-$NAME
    environment:
      - PORT=4000
      - DB_PATH=/app/data/srm.db
    volumes:
      - ./data:/app/data
    networks: [srmnet]
    restart: unless-stopped
networks:
  srmnet:
    name: srmnet
    external: true
EOF

echo "→ Прописываю поддомен $DOMAIN у привратника (HTTPS выпустится автоматически)…"
mkdir -p "$ROOT/proxy/sites"
cat > "$ROOT/proxy/sites/$NAME.caddy" <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy srm-$NAME:4000
}
EOF

echo "→ Запускаю приложение клиента…"
docker compose -f "$CDIR/docker-compose.yml" up -d

echo "→ Перечитываю настройки привратника…"
docker exec srm-proxy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
  || docker compose -f "$ROOT/proxy/docker-compose.yml" restart proxy

echo
echo "✓ Клиент '$NAME' готов:  https://$DOMAIN"
echo "  (первый вход — демо-аккаунты из системы; смените пароли для боевой работы)"
echo "  База клиента: $CDIR/data/srm.db"
