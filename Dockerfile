# СИТИ SRM — образ для деплоя (Timeweb App Platform / любой Docker-хостинг)
# Node 24 нужен для встроенного node:sqlite.
FROM node:24-alpine
WORKDIR /app
COPY . .
# Приложение слушает порт из переменной окружения PORT (по умолчанию 4000).
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server.js"]
