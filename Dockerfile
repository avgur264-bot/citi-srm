# СИТИ SRM — образ для деплоя (Timeweb App Platform / любой Docker-хостинг)
# Node 24 нужен для встроенного node:sqlite.
FROM node:24-alpine
WORKDIR /app
# Российский корневой сертификат (Минцифры) — нужен для TLS к GigaChat (AI-помощник).
# Скачиваем при сборке; проверку TLS НЕ отключаем. Если интернета при сборке нет —
# образ всё равно соберётся, но помощник на GigaChat не подключится (только он; всё прочее работает).
RUN apk add --no-cache curl ca-certificates && \
    (curl -fsSL https://gu-st.ru/content/Other/doc/russiantrustedca.pem \
      -o /usr/local/share/ca-certificates/russian_trusted_root_ca.crt && update-ca-certificates) \
    || echo "WARN: russian root CA not fetched (assistant TLS may fail)"
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/russian_trusted_root_ca.crt
COPY . .
# Приложение слушает порт из переменной окружения PORT (по умолчанию 4000).
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server.js"]
