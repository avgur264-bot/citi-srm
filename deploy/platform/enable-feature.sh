#!/usr/bin/env bash
# Включить/выключить особую функцию ТОЛЬКО для одного клиента.
# Код общий для всех, но функция обёрнута флагом и появляется лишь у тех, кому включили.
#
# Использование:
#   ./enable-feature.sh <клиент> <функция> [on|off]
#   ./enable-feature.sh zimin     floorplan_export        # включить функцию у Зимина
#   ./enable-feature.sh druzhinin special_report          # включить у Дружинина
#   ./enable-feature.sh zimin     floorplan_export off     # выключить у Зимина
#
# Список включённых функций хранится в окружении клиента (FEATURES=через,запятую),
# в БД и браузер не попадает как секрет — просто конфиг. На других клиентов не влияет.
set -euo pipefail

NAME="${1:-}"; FEAT="${2:-}"; MODE="${3:-on}"
if [ -z "$NAME" ] || [ -z "$FEAT" ]; then
  echo "Использование: $0 <клиент> <функция> [on|off]"
  echo "Пример:        $0 druzhinin special_report"
  exit 1
fi
printf '%s' "$FEAT" | grep -qE '^[A-Za-z0-9_]{2,40}$' \
  || { echo "Ошибка: имя функции — 2–40 символов, латиница/цифры/подчёркивание."; exit 1; }
case "$MODE" in on|off) ;; *) echo "Ошибка: третий аргумент — on или off."; exit 1 ;; esac

ROOT="$(cd "$(dirname "$0")" && pwd)"
CF="$ROOT/clients/$NAME/docker-compose.yml"
[ -f "$CF" ] || { echo "Ошибка: клиент '$NAME' не найден ($CF)."; exit 1; }

# текущий список функций из строки FEATURES=... (если есть)
CUR="$(grep -oE 'FEATURES=[^[:space:]]*' "$CF" | head -1 | sed 's/^FEATURES=//' || true)"
# пересобираем список: убираем нашу функцию отовсюду, потом при on — добавляем
NEW="$(printf '%s' "$CUR" | tr ',' '\n' | grep -vxF "$FEAT" | grep -v '^$' || true)"
if [ "$MODE" = "on" ]; then NEW="$(printf '%s\n%s' "$NEW" "$FEAT")"; fi
NEW="$(printf '%s' "$NEW" | grep -v '^$' | paste -sd, - || true)"

BAK="$CF.bak-$(date +%Y%m%d-%H%M%S)"; cp "$CF" "$BAK"
# удаляем прежнюю строку FEATURES и (если список непуст) вписываем заново после 'environment:'
awk -v val="$NEW" '
  /FEATURES=/ { next }
  { print }
  /^[[:space:]]*environment:[[:space:]]*$/ && !done {
    if (val != "") print "      - FEATURES=" val
    done=1
  }
' "$BAK" > "$CF"

echo "→ Пересоздаю контейнер клиента '$NAME'…"
docker compose -f "$CF" up -d

echo
if [ "$MODE" = "on" ]; then
  echo "✓ Функция '$FEAT' ВКЛЮЧЕНА для клиента '$NAME'. Активные функции: ${NEW:-—}"
else
  echo "✓ Функция '$FEAT' ВЫКЛЮЧЕНА у клиента '$NAME'. Активные функции: ${NEW:-—}"
fi
echo "  У остальных клиентов ничего не изменилось."
