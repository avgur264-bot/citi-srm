#!/usr/bin/env bash
# Подключить банк (Сбер API) клиенту: сертификат .p12 + ключи + токены.
# Только чтение выписки (scope GET_STATEMENT_ACCOUNT / GET_CLIENT_ACCOUNTS).
#
# Использование:
#   ./set-sber-keys.sh <клиент> <путь_к_файлу.p12> <пароль_p12> <client_id> <client_secret> <refresh_token> <номер_счёта>
#
# Пример:
#   ./set-sber-keys.sh zimin /root/sber-zimin.p12 'ПарольОтP12' abc-123 s3cr3t rt_xxx 40702810100000001234
#
# Что делает:
#   • кладёт сертификат в data-том клиента (clients/<имя>/data/sber.p12, рядом с базой — не в git);
#   • вписывает переменные окружения в clients/<имя>/docker-compose.yml;
#   • пересоздаёт контейнер клиента.
# Секреты в браузер и в БД не попадают (только окружение + файл на диске сервера).
set -euo pipefail

NAME="${1:-}"; P12="${2:-}"; P12PASS="${3:-}"; CID="${4:-}"; CSECRET="${5:-}"; RTOKEN="${6:-}"; ACCOUNT="${7:-}"
if [ $# -lt 7 ]; then
  echo "Использование: $0 <клиент> <файл.p12> <пароль_p12> <client_id> <client_secret> <refresh_token> <номер_счёта>"
  exit 1
fi
[ -f "$P12" ] || { echo "Ошибка: файл сертификата не найден: $P12"; exit 1; }
printf '%s' "$ACCOUNT" | grep -qE '^[0-9]{20}$' || { echo "Ошибка: номер счёта — 20 цифр."; exit 1; }

ROOT="$(cd "$(dirname "$0")" && pwd)"          # …/deploy/platform
CDIR="$ROOT/clients/$NAME"
CF="$CDIR/docker-compose.yml"
[ -f "$CF" ] || { echo "Ошибка: клиент '$NAME' не найден ($CF)."; exit 1; }

# сертификат кладём в data-том клиента (он уже монтируется в контейнер как /app/data)
mkdir -p "$CDIR/data"
cp "$P12" "$CDIR/data/sber.p12"
chmod 600 "$CDIR/data/sber.p12"
echo "→ Сертификат скопирован в clients/$NAME/data/sber.p12"

BAK="$CF.bak-$(date +%Y%m%d-%H%M%S)"
cp "$CF" "$BAK"
awk -v pass="$P12PASS" -v cid="$CID" -v csec="$CSECRET" -v rtok="$RTOKEN" -v acc="$ACCOUNT" '
  /SBER_PFX_PATH|SBER_PFX_PASS|SBER_CLIENT_ID|SBER_CLIENT_SECRET|SBER_REFRESH_TOKEN|SBER_ACCOUNT|SBER_API_BASE/ { next }
  { print }
  /^[[:space:]]*environment:[[:space:]]*$/ && !done {
    print "      - SBER_PFX_PATH=/app/data/sber.p12"
    print "      - SBER_PFX_PASS=" pass
    print "      - SBER_CLIENT_ID=" cid
    print "      - SBER_CLIENT_SECRET=" csec
    print "      - SBER_REFRESH_TOKEN=" rtok
    print "      - SBER_ACCOUNT=" acc
    done=1
  }
' "$BAK" > "$CF"

if ! grep -q 'SBER_CLIENT_ID=' "$CF"; then
  cp "$BAK" "$CF"
  echo "Ошибка: не нашёл блок 'environment:' в $CF — ключи НЕ вписаны, файл восстановлен."
  exit 1
fi

echo "→ Пересоздаю контейнер клиента '$NAME'…"
docker compose -f "$CF" up -d

echo
echo "✓ Банк (Сбер) подключён для клиента '$NAME'. Счёт: ••••${ACCOUNT: -4}"
echo
echo "Проверка: в интерфейсе → «Синхронизация» → карточка «Банк» → «↻ Синхронизировать»."
echo "Первый прогон покажет в логах пример ответа банка:"
echo "  docker logs --tail 50 srm-$NAME 2>&1 | grep '\[sber\]'"
echo
echo "Напоминание об обслуживании:"
echo "  • client_secret Сбера живёт 40 дней (обновляется автоматически)."
echo "  • TLS-сертификат .p12 действует 12 месяцев — потом перевыпуск в ЛК Sber API и повтор этой команды."
