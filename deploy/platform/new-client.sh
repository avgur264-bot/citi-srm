#!/usr/bin/env bash
# Добавить нового клиента СИТИ SRM. У каждого — своё приложение и своя база
# (полная изоляция данных) на своём поддомене с бесплатным HTTPS.
#
# Использование:
#   ./new-client.sh <имя> <поддомен> [пароль]
#   ./new-client.sh client1 client1.citisrm.ru                 # случайный сильный пароль
#   ./new-client.sh demo demo.citisrm.ru demo2026              # заданный простой пароль (для демо)
set -euo pipefail

NAME="${1:-}"; DOMAIN="${2:-}"
if [ -z "$NAME" ] || [ -z "$DOMAIN" ]; then
  echo "Использование: $0 <имя> <поддомен> [пароль]"
  echo "Пример:        $0 client1 client1.citisrm.ru"
  echo "Демо с паролем: $0 demo demo.citisrm.ru demo2026"
  exit 1
fi
# Имя — только латиница/цифры/дефис (используется в имени контейнера и папке).
if ! echo "$NAME" | grep -qE '^[a-z][a-z0-9-]{1,30}$'; then
  echo "Ошибка: имя клиента — маленькие латинские буквы, цифры и дефис, начинать с буквы (например client1)."
  exit 1
fi
# Домен — только буквы/цифры/точка/дефис (защита от инъекции в конфиги Caddy/Compose).
if ! echo "$DOMAIN" | grep -qE '^[a-zA-Z0-9.-]+$'; then
  echo "Ошибка: поддомен — только латинские буквы, цифры, точка и дефис (например client1.citisrm.ru)."
  exit 1
fi
# Пароль (если задан) — без спецсимволов оболочки (защита от инъекции в heredoc).
if [ -n "${3:-}" ] && ! echo "$3" | grep -qE '^[A-Za-z0-9._-]{6,40}$'; then
  echo "Ошибка: пароль — 6–40 символов: латинские буквы, цифры, точка, дефис, подчёркивание."
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
mkdir -p "$CDIR/data" "$CDIR/files"
# Стартовый пароль учёток. Можно задать 3-м аргументом (для демо-кабинетов с простым паролем),
# иначе генерируется случайный сильный. set +o pipefail — иначе head закрывает пайп → SIGPIPE у tr.
SEED_PW="${3:-}"
if [ -z "$SEED_PW" ]; then
  SEED_PW="$(set +o pipefail; tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)"
  [ -n "$SEED_PW" ] || SEED_PW="$(openssl rand -hex 7 2>/dev/null || echo srmAdmin$$)"
fi
cat > "$CDIR/docker-compose.yml" <<EOF
# Приложение клиента «$NAME». База — в ./data/srm.db (только для этого клиента).
# SEED_PASSWORD — стартовый пароль учёток (применяется один раз при создании базы).
# Регистрация закрыта (ALLOW_REGISTRATION не задан): новых сотрудников заводит админ.
services:
  app:
    image: citi-srm:latest
    container_name: srm-$NAME
    environment:
      - PORT=4000
      - DB_PATH=/app/data/srm.db
      - FILES_PATH=/app/files
      - SEED_PASSWORD=$SEED_PW
$( [ "${SEED_DEMO:-1}" = "0" ] && echo "      - SEED_DEMO=0" )
    volumes:
      - ./data:/app/data
      - ./files:/app/files
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
echo "  ┌─────────────────────────────────────────────────────────"
echo "  │ Вход администратора:"
echo "  │   Логин:  admin@citisrm.ru"
echo "  │   Пароль: $SEED_PW"
echo "  ├─────────────────────────────────────────────────────────"
echo "  │ Этот пароль показан ОДИН раз — сохраните и передайте клиенту."
echo "  │ Регистрация закрыта; сотрудников заводит админ в разделе «Сотрудники»."
echo "  │ После первого входа пароль лучше сменить."
echo "  ├─────────────────────────────────────────────────────────"
echo "  │ База: $( [ "${SEED_DEMO:-1}" = "0" ] && echo 'ЧИСТАЯ (без примеров) — заносите свои объекты' || echo 'с демо-данными (примеры)' )"
echo "  └─────────────────────────────────────────────────────────"
echo "  База клиента: $CDIR/data/srm.db"
