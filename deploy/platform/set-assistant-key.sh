#!/usr/bin/env bash
# Задать ключ AI-помощника (GigaChat) для клиента и пересоздать только его контейнер.
# Использование:
#   ./set-assistant-key.sh <клиент> <authorization_key> [scope]
#   ./set-assistant-key.sh demo <ВАШ_КЛЮЧ> GIGACHAT_API_PERS
# Ключ вписывается в окружение клиента (clients/<имя>/docker-compose.yml) — в БД не попадает.
set -euo pipefail

NAME="${1:-}"; KEY="${2:-}"; SCOPE="${3:-GIGACHAT_API_PERS}"
if [ -z "$NAME" ] || [ -z "$KEY" ]; then
  echo "Использование: $0 <клиент> <authorization_key> [scope]"
  echo "Пример:        $0 demo <ВАШ_КЛЮЧ> GIGACHAT_API_PERS"
  exit 1
fi
ROOT="$(cd "$(dirname "$0")" && pwd)"          # …/deploy/platform
CF="$ROOT/clients/$NAME/docker-compose.yml"
[ -f "$CF" ] || { echo "Ошибка: клиент '$NAME' не найден ($CF)."; exit 1; }
# мягкая проверка формата ключа (base64-подобный), чтобы не вписать мусор
printf '%s' "$KEY" | grep -qE '^[A-Za-z0-9+/=._:-]{20,500}$' \
  || { echo "Ошибка: ключ выглядит некорректно (ожидается длинная строка Authorization key)."; exit 1; }

BAK="$CF.bak-$(date +%Y%m%d-%H%M%S)"
cp "$CF" "$BAK"
# Убираем прежние строки ключа/scope и вписываем заново сразу после 'environment:'.
awk -v key="$KEY" -v scope="$SCOPE" '
  /GIGACHAT_AUTH_KEY|GIGACHAT_SCOPE|LLM_PROVIDER|LLM_MODEL/ { next }
  { print }
  /^[[:space:]]*environment:[[:space:]]*$/ && !done {
    print "      - GIGACHAT_AUTH_KEY=" key
    print "      - GIGACHAT_SCOPE=" scope
    done=1
  }
' "$BAK" > "$CF"

# Проверка, что ключ действительно вписан (иначе в шаблоне не нашёлся блок environment:) — откатываемся.
if ! grep -q 'GIGACHAT_AUTH_KEY=' "$CF"; then
  cp "$BAK" "$CF"
  echo "Ошибка: не нашёл блок 'environment:' в $CF — ключ НЕ вписан, файл восстановлен. Проверьте формат compose."
  exit 1
fi

echo "→ Пересоздаю контейнер клиента '$NAME'…"
docker compose -f "$CF" up -d
echo
echo "✓ Ключ GigaChat задан для клиента '$NAME' (scope: $SCOPE). Контейнер пересоздан."
echo "  Дальше: на сайте клиента → Настройки → AI-помощник → включить."
