# СИТИ SRM — платформа на несколько клиентов (Путь A)

Несколько клиентов на одном сервере. У каждого — **своё приложение и своя база**
(полная изоляция данных) на **своём поддомене** с бесплатным HTTPS.

```
client1.citisrm.ru ──┐
client2.citisrm.ru ──┼──►  srm-proxy (Caddy, порты 80/443, авто-HTTPS)
client3.citisrm.ru ──┘             │
                                    ├──► srm-client1  →  clients/client1/data/srm.db
                                    ├──► srm-client2  →  clients/client2/data/srm.db
                                    └──► srm-client3  →  clients/client3/data/srm.db
```

## Что нужно один раз
1. **Домен** `citisrm.ru` и DNS-записи на IP сервера:
   - `A  @  147.45.253.247`
   - `A  *  147.45.253.247`  ← звёздочка (wildcard): любой поддомен ведёт на сервер
2. **Код на сервере** в `/opt/citi-srm` (как сейчас) и установленный Docker.

## Установка платформы (один раз)
```bash
cd /opt/citi-srm/server-app/deploy/platform
chmod +x *.sh
./setup.sh
```
> ⚠️ Платформа занимает порты 80/443. Если ещё работает старый одиночный запуск
> (`/opt/citi-srm/deploy`), сначала остановите его:
> `docker compose -f /opt/citi-srm/deploy/docker-compose.yml down`
> (база останется в `/opt/citi-srm/deploy/data` — её можно перенести первому клиенту).

## Добавить клиента (одна команда)
```bash
./new-client.sh client1 client1.citisrm.ru
```
Через минуту у клиента рабочий кабинет на `https://client1.citisrm.ru`.
Повторяйте для каждого нового клиента.

## Повседневные команды
| Команда | Что делает |
|---------|-----------|
| `./list-clients.sh` | список клиентов, поддомены, статус, размер базы |
| `./update-all.sh` | обновить программу у всех клиентов (git pull + пересборка) |
| `./backup-all.sh` | резервные копии баз всех клиентов |
| `docker logs srm-client1` | логи приложения конкретного клиента |
| `docker compose -f clients/client1/docker-compose.yml down` | остановить клиента |

## Перенести текущий тест первым клиентом (необязательно)
Если хотите сохранить данные нынешнего теста:
```bash
./new-client.sh demo demo.citisrm.ru                 # создаст пустого клиента
docker compose -f clients/demo/docker-compose.yml down
cp /opt/citi-srm/deploy/data/srm.db clients/demo/data/srm.db   # перенос базы
docker compose -f clients/demo/docker-compose.yml up -d
```

## Безопасность для боевой работы
Перед заведением реальных клиентов: сменить демо-пароли, закрыть свободную
регистрацию, проверить HTTPS (замочек). Скрипт `backup-all.sh` поставить в cron
на ежедневный запуск.
