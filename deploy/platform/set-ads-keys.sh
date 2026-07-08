#!/usr/bin/env bash
# Задать ключи площадки Авито для клиента и пересоздать только его контейнер.
# Использование:
#   ./set-ads-keys.sh <клиент> <AVITO_CLIENT_ID> <AVITO_CLIENT_SECRET> <AVITO_USER_ID> [FEED_TOKEN]
#   ./set-ads-keys.sh zimin abc123 secretXXXX 987654 my-feed-token
# Ключи вписываются в окружение клиента (clients/<имя>/docker-compose.yml) — в БД/браузер не попадают.
set -euo pipefail

NAME="${1:-}"; CID="${2:-}"; CSECRET="${3:-}"; UID_AV="${4:-}"; FEED="${5:-}"
if [ -z "$NAME" ] || [ -z "$CID" ] || [ -z "$CSECRET" ] || [ -z "$UID_AV" ]; then
  echo "Использование: $0 <клиент> <AVITO_CLIENT_ID> <AVITO_CLIENT_SECRET> <AVITO_USER_ID> [FEED_TOKEN]"
  echo "Пример:        $0 zimin abc123 secretXXXX 987654 my-feed-token"
  exit 1
fi
ROOT="$(cd "$(dirname "$0")" && pwd)"          # …/deploy/platform
CF="$ROOT/clients/$NAME/docker-compose.yml"
[ -f "$CF" ] || { echo "Ошибка: клиент '$NAME' не найден ($CF)."; exit 1; }
# мягкая проверка: user_id — числовой; id/secret — непустые без переносов строк
printf '%s' "$UID_AV" | grep -qE '^[0-9]{1,20}$' \
  || { echo "Ошибка: AVITO_USER_ID должен быть числом."; exit 1; }
printf '%s' "$CID$CSECRET$FEED" | grep -qE '^[A-Za-z0-9+/=._:-]*$' \
  || { echo "Ошибка: id/secret/токен содержат недопустимые символы."; exit 1; }

BAK="$CF.bak-$(date +%Y%m%d-%H%M%S)"
cp "$CF" "$BAK"
# Убираем прежние строки ключей Авито и вписываем заново сразу после 'environment:'.
awk -v cid="$CID" -v csec="$CSECRET" -v uid="$UID_AV" -v feed="$FEED" '
  /AVITO_CLIENT_ID|AVITO_CLIENT_SECRET|AVITO_USER_ID|FEED_TOKEN/ { next }
  { print }
  /^[[:space:]]*environment:[[:space:]]*$/ && !done {
    print "      - AVITO_CLIENT_ID=" cid
    print "      - AVITO_CLIENT_SECRET=" csec
    print "      - AVITO_USER_ID=" uid
    if (feed != "") print "      - FEED_TOKEN=" feed
    done=1
  }
' "$BAK" > "$CF"

# Проверка, что ключ действительно вписан (иначе не нашёлся блок environment:) — откатываемся.
if ! grep -q 'AVITO_CLIENT_ID=' "$CF"; then
  cp "$BAK" "$CF"
  echo "Ошибка: не нашёл блок 'environment:' в $CF — ключи НЕ вписаны, файл восстановлен."
  exit 1
fi

echo "→ Пересоздаю контейнер клиента '$NAME'…"
docker compose -f "$CF" up -d
echo
echo "✓ Ключи Авито заданы для клиента '$NAME'. Контейнер пересоздан."
echo "  Дальше: раздел «Реклама» → у объявлений заполните «ID на площадке (extId)» → «↻ Авито»."
echo "  Ссылку на XML-фид (для кабинета Авито) видно в разделе «Реклама» → блок интеграции."
