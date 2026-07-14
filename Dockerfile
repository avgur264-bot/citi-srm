# СИТИ SRM — образ для деплоя (Timeweb App Platform / любой Docker-хостинг)
# Node 24 нужен для встроенного node:sqlite.
FROM node:24-alpine
WORKDIR /app
# Российский корневой сертификат (Минцифры) — нужен для TLS к GigaChat (AI-помощник).
# Скачиваем при сборке; проверку TLS НЕ отключаем. Если интернета при сборке нет —
# образ всё равно соберётся, но помощник на GigaChat не подключится (только он; всё прочее работает).
# su-exec — чтобы сбросить права root после подготовки томов (см. docker-entrypoint.sh).
RUN apk add --no-cache curl ca-certificates su-exec && \
    (curl -fsSL https://gu-st.ru/content/Other/doc/russiantrustedca.pem \
      -o /usr/local/share/ca-certificates/russian_trusted_root_ca.crt && update-ca-certificates) \
    || echo "WARN: russian root CA not fetched (assistant TLS may fail)"
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/russian_trusted_root_ca.crt
COPY . .
RUN chmod +x /app/docker-entrypoint.sh && chown -R node:node /app
# Приложение слушает порт из переменной окружения PORT (по умолчанию 4000).
ENV PORT=4000
EXPOSE 4000
# Стартуем от root ТОЛЬКО чтобы поправить права на смонтированных томах (data/files),
# затем entrypoint переключается на пользователя node (uid 1000) и уже он запускает сервер.
# Если приложение когда-нибудь взломают, злоумышленник окажется без прав root в контейнере.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
