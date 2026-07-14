#!/usr/bin/env bash
# Подключение банка (Сбер API) — ПРОСТОЙ режим: скрипт спрашивает всё по очереди.
# Ничего не надо собирать в одну длинную команду.
#
# Запуск:
#   cd /opt/citi-srm/deploy/platform
#   bash sber-setup.sh
#
# Перед запуском положите сертификат .p12 на сервер (обычно в /root/).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
echo
echo "════════════════════════════════════════════════════════"
echo "  Подключение банка (Сбер API) — пошагово"
echo "════════════════════════════════════════════════════════"
echo "Отвечайте на вопросы. В [скобках] — значение по умолчанию:"
echo "если оно подходит, просто нажмите Enter."
echo

# 1. клиент
read -rp "1) Имя клиента [zimin]: " NAME
NAME="${NAME:-zimin}"
CF="$ROOT/clients/$NAME/docker-compose.yml"
if [ ! -f "$CF" ]; then
  echo "   ✗ Клиент '$NAME' не найден. Доступные:"
  ls -1 "$ROOT/clients" 2>/dev/null | sed 's/^/     - /'
  exit 1
fi
echo "   ✓ Клиент найден"
echo

# 2. сертификат
read -rp "2) Путь к сертификату .p12 на сервере [/root/sber-zimin.p12]: " P12
P12="${P12:-/root/sber-zimin.p12}"
if [ ! -f "$P12" ]; then
  echo "   ✗ Файл не найден: $P12"
  echo "     Сначала скопируйте сертификат на сервер, например с компьютера:"
  echo "       scp <файл.p12> root@147.45.253.247:/root/sber-zimin.p12"
  exit 1
fi
echo "   ✓ Сертификат найден ($(du -h "$P12" | cut -f1))"
echo

# 3. пароль (скрытый ввод — на экране не отображается)
read -rsp "3) Пароль от сертификата .p12 (ввод скрыт): " P12PASS; echo
[ -n "$P12PASS" ] || { echo "   ✗ Пароль не может быть пустым"; exit 1; }
echo "   ✓ Пароль принят"
echo

# 4-6. ключи и токен
read -rp "4) Client ID: " CID
[ -n "$CID" ] || { echo "   ✗ Client ID обязателен"; exit 1; }
read -rp "5) Client Secret: " CSECRET
[ -n "$CSECRET" ] || { echo "   ✗ Client Secret обязателен"; exit 1; }
read -rp "6) Refresh token: " RTOKEN
[ -n "$RTOKEN" ] || { echo "   ✗ Refresh token обязателен"; exit 1; }
echo

# 7. счёт
read -rp "7) Номер расчётного счёта (20 цифр): " ACCOUNT
ACCOUNT="$(printf '%s' "$ACCOUNT" | tr -d ' ')"
printf '%s' "$ACCOUNT" | grep -qE '^[0-9]{20}$' || { echo "   ✗ Счёт должен быть ровно 20 цифр (введено: ${#ACCOUNT})"; exit 1; }
echo "   ✓ Счёт принят: ••••${ACCOUNT: -4}"
echo

# 8. контур
echo "8) Какой контур Сбера?"
echo "   1 — Песочница (тестовая учётка Sber API)"
echo "   2 — Боевой (реальный счёт)"
read -rp "   Выберите 1 или 2 [1]: " K
K="${K:-1}"
case "$K" in
  1) ENVKIND="test" ;;
  2) ENVKIND="prod" ;;
  *) echo "   ✗ Введите 1 или 2"; exit 1 ;;
esac
echo "   ✓ Контур: $ENVKIND"
echo

# подтверждение
echo "────────────────────────────────────────────────────────"
echo "Проверьте:"
echo "  Клиент:      $NAME"
echo "  Сертификат:  $P12"
echo "  Client ID:   ${CID:0:8}… (скрыт)"
echo "  Счёт:        ••••${ACCOUNT: -4}"
echo "  Контур:      $ENVKIND"
echo "────────────────────────────────────────────────────────"
read -rp "Всё верно? Подключаем? (y/n) [y]: " YES
YES="${YES:-y}"
[ "$YES" = "y" ] || [ "$YES" = "Y" ] || { echo "Отменено."; exit 0; }
echo

bash "$ROOT/set-sber-keys.sh" "$NAME" "$P12" "$P12PASS" "$CID" "$CSECRET" "$RTOKEN" "$ACCOUNT" "$ENVKIND"

echo
echo "════════════════════════════════════════════════════════"
echo "  Готово. Что дальше:"
echo "    1. Откройте сайт клиента → раздел «Синхронизация»"
echo "    2. Карточка «Банк» → кнопка «↻ Синхронизировать»"
echo "    3. Посмотрите лог первого прогона:"
echo "         docker logs --tail 60 srm-$NAME 2>&1 | grep '\[sber\]'"
echo "════════════════════════════════════════════════════════"
