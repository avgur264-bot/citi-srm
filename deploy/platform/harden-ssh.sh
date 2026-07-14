#!/usr/bin/env bash
# Закрыть вход на сервер по ПАРОЛЮ — оставить только вход по ключу.
# Запускать НА СЕРВЕРЕ, ПОСЛЕ того как ключ с вашего компьютера уже добавлен и вы
# проверили, что заходите БЕЗ пароля. Иначе можно закрыть себе доступ.
#
#   bash harden-ssh.sh
#
# Что делает: проверяет наличие ключей в ~/.ssh/authorized_keys, отключает
# PasswordAuthentication и вход по паролю для root, перезапускает sshd.
# Старый конфиг сохраняется рядом (.bak) — можно откатить.
set -euo pipefail

AK="${HOME}/.ssh/authorized_keys"
echo "════════════════════════════════════════════"
echo "  Защита SSH: вход только по ключу"
echo "════════════════════════════════════════════"

if [ ! -s "$AK" ]; then
  echo "✗ В $AK нет ни одного ключа."
  echo "  Сначала на СВОЁМ компьютере (Терминал):"
  echo "     ssh-keygen -t ed25519            # если ключа ещё нет (Enter на все вопросы)"
  echo "     ssh-copy-id root@147.45.253.247  # добавит ключ на сервер (спросит пароль)"
  echo "  Затем проверьте: ssh root@147.45.253.247 — должно пустить БЕЗ пароля."
  echo "  И только после этого запускайте этот скрипт."
  exit 1
fi
echo "✓ Ключей найдено: $(grep -c '^ssh-' "$AK" || true)"

read -rp "Вы ТОЧНО заходите на сервер без ввода пароля? (yes/no): " OK
[ "$OK" = "yes" ] || { echo "Отменено. Сначала настройте вход по ключу."; exit 0; }

CFG=/etc/ssh/sshd_config
cp "$CFG" "$CFG.bak-$(date +%Y%m%d-%H%M%S)"

set_opt(){ # ключ значение
  if grep -qE "^[#[:space:]]*$1[[:space:]]" "$CFG"; then
    sed -i -E "s|^[#[:space:]]*$1[[:space:]].*|$1 $2|" "$CFG"
  else
    printf '%s %s\n' "$1" "$2" >> "$CFG"
  fi
}
set_opt PasswordAuthentication no
set_opt PermitRootLogin prohibit-password
set_opt ChallengeResponseAuthentication no
set_opt KbdInteractiveAuthentication no
set_opt PubkeyAuthentication yes
set_opt MaxAuthTries 3

# на Ubuntu 24 включаемые файлы могут переопределять настройки — гасим пароль и там
for f in /etc/ssh/sshd_config.d/*.conf; do
  [ -e "$f" ] || continue
  sed -i -E 's|^[#[:space:]]*PasswordAuthentication[[:space:]].*|PasswordAuthentication no|' "$f" || true
done

sshd -t && systemctl restart ssh 2>/dev/null || systemctl restart sshd
echo
echo "✓ Готово. Вход по паролю отключён, работает только ключ."
echo "  ⚠️ НЕ ЗАКРЫВАЙТЕ это окно: откройте ВТОРОЕ и проверьте вход."
echo "  Если что-то не так — откат: cp $CFG.bak-* $CFG && systemctl restart ssh"
