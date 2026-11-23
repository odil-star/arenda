<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&height=220&color=0:6366F1,50:8B5CF6,100:EC4899&text=Arenda&fontSize=72&fontColor=ffffff&fontAlignY=38&desc=%D0%A3%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%BE%D0%B9%20%D0%BD%D0%B5%D0%B4%D0%B2%D0%B8%D0%B6%D0%B8%D0%BC%D0%BE%D1%81%D1%82%D0%B8&descAlignY=60&descSize=20" alt="Arenda — управление арендой недвижимости" width="100%"/>

### 🏢 SaaS для арендодателей Узбекистана — от 1 до 100 объектов

*Объекты, жильцы, договоры, график платежей, напоминания в Telegram и оплата через Payme / Click — в одном месте.*

<br/>

![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Django](https://img.shields.io/badge/Django-5-092E20?style=for-the-badge&logo=django&logoColor=white)
![DRF](https://img.shields.io/badge/DRF-REST_API-A30000?style=for-the-badge&logo=django&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Celery](https://img.shields.io/badge/Celery-37814A?style=for-the-badge&logo=celery&logoColor=white)

![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-aiogram_3-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)

<br/>

[🚀 Быстрый старт](#-быстрый-старт) ·
[✨ Возможности](#-возможности) ·
[🏗 Архитектура](#-архитектура) ·
[🔌 API](#-основные-эндпоинты) ·
[🚢 Продакшен](#-продакшен-и-https)

</div>

---

## ✨ Возможности

<table>
<tr>
<td width="50%" valign="top">

### 👔 Кабинет арендодателя
- 🏠 **Объекты** — квартиры, дома, коммерция, фото и документы
- 👥 **Арендаторы** — карточки, приглашения по ссылке, QR и SMS
- 📝 **Договоры** — автоматический **PDF**, продление и завершение в один клик
- 📅 **График платежей** — генерируется вместе с договором, статусы считаются на лету
- 📊 **Отчёты** — доход / расход / прибыль, экспорт в **CSV** и **XLSX**
- 📸 **Фото и видео** состояния квартиры, показания счётчиков, расходы
- 🧾 **Журнал действий** — кто, что и когда сделал

</td>
<td width="50%" valign="top">

### 🧑‍💼 Кабинет жильца
- 🔗 Вход по **приглашению**, **QR** или **коду из SMS**
- 💰 Только **свои** договоры и платежи
- 📤 Оплата по реквизитам и **загрузка чека** — деньги зачисляются после подтверждения
- 🔔 Уведомления о новых фото и видео, **Web Push**
- 🔐 Вход по **Passkey** (WebAuthn)
- 📱 Установка как **PWA** на телефон

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🤖 Автоматизация
- ⏰ Ежедневно в **09:00** (Ташкент): напоминание за 3 дня, в день срока и при просрочке
- 💬 **Telegram-бот** — `/balance`, `/pay_info`
- 🌐 Шаблоны сообщений на **русском** и **узбекском**
- ♻️ Идемпотентная рассылка — ни одного дубля

</td>
<td width="50%" valign="top">

### 💳 Платежи
- 🟦 **Payme** — JSON-RPC, суммы в тийинах
- 🟩 **Click** — Prepare / Complete, проверка подписи
- 🛡 Защита от двойного зачисления (`select_for_update` + уникальный ключ)
- ⏱ Информационная **пеня** за просрочку

</td>
</tr>
</table>

> 🧩 **Дополнительно:** панель администратора платформы (объявления, аудит, имперсонация), объявления и поддержка,
> два языка интерфейса (**ru / uz**), светлая и тёмная темы, адаптивный дизайн «телефон — прежде всего».

---

## 🏗 Архитектура

```mermaid
flowchart LR
    subgraph Clients["👥 Клиенты"]
        L["🏢 Арендодатель<br/>React PWA"]
        T["🧑 Жилец<br/>React PWA"]
        TG["💬 Telegram"]
    end

    subgraph Edge["🌐 Edge"]
        N["nginx + Let's Encrypt"]
    end

    subgraph Core["⚙️ Django монолит"]
        API["REST API<br/>DRF + JWT"]
        W["Celery worker"]
        B["Celery beat<br/>09:00 Ташкент"]
        BOT["Бот aiogram 3"]
    end

    subgraph Data["💾 Данные"]
        PG[("PostgreSQL")]
        R[("Redis")]
        S3[("S3 / R2 / MinIO")]
    end

    subgraph Ext["🔌 Внешние сервисы"]
        PM["Payme"]
        CL["Click"]
        SMS["Eskiz SMS"]
    end

    L & T --> N --> API
    TG <--> BOT
    PM & CL -. вебхуки .-> API
    API --> PG & S3
    API --> R
    B --> R --> W
    W --> PG
    W --> TG
    W --> SMS
    BOT --> PG
```

**Принципы:** один монолит без лишних абстракций · часовой пояс `Asia/Tashkent` · даты-время в БД — UTC ·
деньги — **только целые числа в сумах** · интерфейс на `ru`.

---

## 🧰 Технологии

| Слой | Что используем |
|---|---|
| 🐍 **Backend** | Django 5 · Django REST Framework · simplejwt · drf-spectacular (OpenAPI) |
| 🗄 **Данные** | PostgreSQL (SQLite в dev) · Redis · S3-совместимое хранилище (django-storages) |
| ⚡ **Фон** | Celery + Celery beat |
| 📄 **Документы** | WeasyPrint (PDF-договоры и чеки) · openpyxl (XLSX) · qrcode |
| 🔔 **Каналы** | aiogram 3 (Telegram) · Eskiz (SMS) · pywebpush · WebAuthn |
| 🎨 **Frontend** | React 18 · Vite · TypeScript strict · Tailwind CSS v4 · Radix UI · TanStack Query |
| 📝 **Формы / i18n** | React Hook Form + Zod · i18next (ru / uz) · Recharts |
| 🚢 **Инфраструктура** | Docker Compose · nginx · certbot · Sentry |

---

## 🚀 Быстрый старт

```bash
git clone <repo-url> rent && cd rent
cp backend/.env.example backend/.env        # задайте SECRET_KEY
docker compose up --build
docker compose exec django python manage.py createsuperuser
```

<div align="center">

| 🌐 Что | 🔗 Где |
|:---:|:---:|
| API | http://localhost/api/ |
| Swagger | http://localhost/api/docs/ (при `API_DOCS_ENABLED=True`) |
| Админка | http://localhost/admin/ |
| Интерфейс (dev) | `docker compose --profile dev up frontend` |

</div>

> 💡 Без Docker достаточно Python: по умолчанию используется SQLite, ничего настраивать не нужно —
> см. [Локальный запуск](#-локальный-запуск).

### 🗺 Что поднимается

| Сервис | Роль |
|---|---|
| `django` | gunicorn, REST API |
| `worker` · `beat` | Celery: фоновые задачи и ежедневные напоминания |
| `bot` | Telegram-бот (long polling) |
| `db` · `redis` | PostgreSQL и Redis |
| `nginx` | порт 80, статика фронтенда и прокси к API |

---

# 📚 Документация

Роль определяется запросом `/api/me/`: для жильца он возвращает 403 — это штатное поведение, не ошибка.
Фронтенд (`frontend/`) описан в [frontend/README.md](frontend/README.md).

## 💻 Локальный запуск

По умолчанию (dev) используется SQLite-файл `backend/db.sqlite3` — ничего настраивать не нужно.
PostgreSQL — через `DATABASE_URL`; в проде он обязателен.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# export DATABASE_URL=postgres://rent:rent@localhost:5432/rent   # по желанию, вместо SQLite
python manage.py migrate && python manage.py runserver     # настройки config.settings.dev
python manage.py test                                      # тесты
celery -A config worker -B -l info                         # напоминания и фоновые задачи
python manage.py run_bot                                   # Telegram-бот
```

`manage.py` использует `config.settings.dev`, `wsgi`/`celery` — `config.settings.prod`
(`DEBUG=False`, обязательные `SECRET_KEY` и `ALLOWED_HOSTS`, защищённые cookie, HSTS, редирект на HTTPS).

## 🔧 Переменные окружения

Полный список с комментариями — [backend/.env.example](backend/.env.example).

| Группа | Переменные |
|---|---|
| Django | `SECRET_KEY`, `ALLOWED_HOSTS`, `DEBUG` (только dev), `CORS_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `SECURE_SSL_REDIRECT`, `NUM_PROXIES`, `AUTH_THROTTLE_RATE` |
| Данные | `DATABASE_URL`, `REDIS_URL`, `CELERY_EAGER` |
| Кабинет жильца | `FRONTEND_URL`, `SMS_BACKEND` (`console` \| `eskiz`), `ESKIZ_EMAIL`, `ESKIZ_PASSWORD` |
| Telegram | `TELEGRAM_BOT_TOKEN` |
| Платежи | `PAYME_MERCHANT_ID`, `PAYME_KEY`, `PAYME_CHECKOUT_URL`, `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY` |
| Файлы (S3/R2/MinIO) | `AWS_STORAGE_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_ENDPOINT_URL`, `AWS_S3_REGION_NAME` |

## 🧱 Правила данных

- Каждая бизнес-таблица наследует `OwnedModel` (владелец берётся из JWT, а не из тела запроса).
  Чужой объект — **404**, внешние ключи принимают только свои объекты.
- Ошибки — `{"поле": ["сообщение"]}` на русском; для общих ошибок ключ `detail` / `non_field_errors`.
- Все списки пагинируются (`?page=`, `?page_size=` до 100).
- Ограничения в БД: `end_date > start_date`, `payment_day` 1–28, один действующий договор на объект,
  один платёж на `(договор, дата)`, уникальный `(provider, external_id)` у оплат.
- Критичные действия пишутся в журнал: `GET /api/audit/` (создание/продление/завершение договора, оплаты,
  возвраты, удаления, загрузки файлов, экспорт).
- Статус платежа (`paid | partial | overdue | pending`) вычисляется, не хранится.

## 🔌 Основные эндпоинты

| Метод | URL | Описание |
|---|---|---|
| POST | `/api/auth/register/`, `/api/auth/token/`, `/api/auth/token/refresh/` | регистрация, JWT (10 запросов/мин на IP) |
| GET/PATCH | `/api/me/` | профиль; `POST /api/me/telegram-link/` — код привязки Telegram владельца |
| CRUD | `/api/properties/`, `/api/tenants/`, `/api/leases/` | `POST /api/tenants/{id}/link-code/` — код для бота |
| POST | `/api/leases/{id}/end/`, `/api/leases/{id}/extend/` `{end_date}` | завершить / продлить (досоздаёт платежи) |
| GET | `/api/leases/{id}/contract/` (`?as=html`) | PDF-договор |
| GET | `/api/payments/?status=&lease=&property=&due_from=&due_to=` | график платежей |
| POST | `/api/payments/{id}/pay/` `{amount, idempotency_key?}` | ручная оплата (заголовок `Idempotency-Key` тоже работает) |
| POST | `/api/payments/{id}/invoice/` `{amount?}` | ссылки на оплату Payme/Click |
| POST | `/api/webhooks/payme/`, `/api/webhooks/click/` | вебхуки провайдеров (подпись/Basic-авторизация) |
| CRUD | `/api/documents/` (multipart), `GET /api/documents/{id}/download/` | PDF/JPG/PNG: документы ≤ 10 МБ, фото ≤ 5 МБ |
| CRUD | `/api/meter-readings/`, `/api/expenses/` | показания счётчиков, расходы по объекту |
| GET | `/api/reports/summary/?date_from=&date_to=&property=` | доход / расход / прибыль |
| GET | `/api/reports/export/?file=csv\|xlsx&…` | тот же отчёт файлом |
| GET | `/api/dashboard/`, `/api/audit/` | сводка, журнал действий |

## 🧪 Примеры curl

```bash
API=http://localhost/api

curl -X POST $API/auth/register/ -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"Str0ng-pass-987","first_name":"Алишер"}'

TOKEN=$(curl -s -X POST $API/auth/token/ -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"Str0ng-pass-987"}' | python -c 'import sys,json;print(json.load(sys.stdin)["access"])')
AUTH="Authorization: Bearer $TOKEN"

curl -X POST $API/properties/ -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"Кв. Юнусабад 12","address":"Ташкент, Юнусабад","kind":"apartment","area_m2":"54.5"}'
curl -X POST $API/tenants/ -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"full_name":"Иван Петров","phone":"+998901234567"}'

# договор + график платежей одной транзакцией
curl -X POST $API/leases/ -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"property":1,"tenant":1,"start_date":"2026-01-01","end_date":"2026-12-31","rent_amount":3000000,"deposit_amount":3000000,"payment_day":5}'

curl "$API/payments/?status=overdue" -H "$AUTH"
curl -X POST $API/payments/1/pay/ -H "$AUTH" -H 'Idempotency-Key: pay-2026-01' -H 'Content-Type: application/json' -d '{"amount":1000000}'
curl -X POST $API/leases/1/extend/ -H "$AUTH" -H 'Content-Type: application/json' -d '{"end_date":"2027-06-30"}'
curl -X POST $API/payments/1/invoice/ -H "$AUTH"
curl -X POST $API/documents/ -H "$AUTH" -F property=1 -F kind=photo -F file=@photo.jpg
curl "$API/reports/export/?date_from=2026-01-01&date_to=2026-12-31&file=xlsx" -H "$AUTH" -o report.xlsx
curl $API/leases/1/contract/ -H "$AUTH" -o contract.pdf
```

## 🏠 Подключение жильцов

Арендодатель приглашает жильца; жилец создаёт аккаунт (`role=tenant`) и видит только **свои** договоры и платежи.
Три способа — один результат (`Tenant.user` привязан к аккаунту):

1. **Ссылка** `https://<FRONTEND_URL>/join/<token>` — `POST /api/tenants/{id}/invite/` → `{url, expires_at}`.
2. **QR** той же ссылки — `GET /api/tenants/{id}/invite/qr/?token=…` (SVG). Отдельного токена у QR нет.
3. **Телефон** — вход по SMS-коду; аккаунт привязывается к записи `Tenant` с тем же номером.

Роли: `UserProfile.role = landlord | tenant`. Все прежние эндпоинты — только для арендодателя
(`IsLandlord` по умолчанию), `/api/tenant/*` — только для жильца (`IsTenantRole`).

| Метод | URL | Кто | Описание |
|---|---|---|---|
| POST | `/api/tenants/{id}/invite/` | арендодатель | новое приглашение, прежние активные отзываются; токен виден **только** в этом ответе |
| GET | `/api/tenants/{id}/invite/qr/?token=` | арендодатель | SVG-QR; токен берётся из ответа `invite` |
| POST | `/api/tenants/{id}/unlink/` | арендодатель | отвязать аккаунт, отозвать приглашения, выключить `phone_claim_enabled` |
| POST / GET | `/api/properties/{id}/invite/`, `/api/properties/{id}/invite/qr/?token=` | арендодатель | то же, но от объекта: жилец действующего договора; если договора нет — создаётся заготовка жильца, который сам введёт имя и телефон при принятии (`full_name`, `phone` в `accept` / `register-tenant`) |
| GET | `/api/invites/{token}/` | публично | превью: `{valid, landlord_name, property_name}`; 404 одинаков для любого плохого токена |
| POST | `/api/invites/accept/` `{token}` | JWT жильца | привязать аккаунт; одноразово |
| POST | `/api/auth/register-tenant/` `{email, password, token}` | публично | регистрация + принятие одним запросом |
| POST | `/api/auth/phone/request/` `{phone}` | публично | отправить 6-значный код (3 запроса / 10 мин на номер и на IP; ответ всегда одинаков) |
| POST | `/api/auth/phone/verify/` `{phone, code}` | публично | ≤ 5 попыток; возвращает `{access, refresh}` |
| GET | `/api/tenant/me/`, `/api/tenant/leases/`, `/api/tenant/payments/?status=` | JWT жильца | только записи с `tenant.user == request.user` |

**Оплата по чеку.** Когда наступил месяц платежа (или он просрочен), жилец видит кнопку «Оплатить»: переводит деньги
по реквизитам арендодателя (`payment_details`) и отправляет скриншот чека. Деньги зачисляются только после подтверждения.

| Метод | URL | Кто | Описание |
|---|---|---|---|
| POST | `/api/tenant/payments/{id}/receipts/` (multipart `file`, `amount?`) | жилец | отправить чек (PDF/JPG/PNG ≤ 10 МБ); один чек «на проверке» на платёж |
| GET | `/api/receipts/?status=pending\|confirmed\|rejected` | арендодатель | чеки; `GET /api/receipts/{id}/file/` — сам файл |
| POST | `/api/receipts/{id}/confirm/` `{amount?}` | арендодатель | подтвердить: оплата зачисляется (идемпотентно), в журнал `receipt.confirmed` |
| POST | `/api/receipts/{id}/reject/` `{reason?}` | арендодатель | отклонить; жилец видит причину и может отправить снова |
| POST | `/api/lease-media/` (multipart `lease`, `file`) | арендодатель | фото (JPG/PNG/WebP ≤ 15 МБ) или видео (MP4/MOV/WebM ≤ 100 МБ) состояния квартиры, до 40 файлов на договор; тип проверяется по содержимому |
| GET/DELETE | `/api/lease-media/?lease=` · `/api/lease-media/{id}/` · `…/file/` | арендодатель | список, удаление, сам файл |
| POST | `/api/lease-media/{id}/replace/` (multipart `file`) | арендодатель | заменить файл; жилец получает уведомление «изменено» |
| GET | `/api/tenant/media/?lease=` · `/api/tenant/media/{id}/file/` | жилец | материалы своего договора |
| GET/POST | `/api/tenant/notifications/` · `/api/tenant/notifications/read/` | жилец | уведомления о добавленных/изменённых фото и видео (серия загрузок схлопывается в одно, пока оно не прочитано) |

В `/api/tenant/payments/` добавлены `can_pay`, `receipt_status` (`none|pending|confirmed|rejected`), `receipt_reject_reason`,
`landlord_name`, `payment_details`.

В `TenantSerializer` добавлены `is_linked`, `invite_status` (`none|pending|expired|used`), `phone_claim_enabled`.

**Безопасность.** Токен приглашения (`secrets.token_urlsafe(32)`) и SMS-код хранятся только как хэши
(sha256 / HMAC с `SECRET_KEY`), сравнение — `hmac.compare_digest`. Приглашение живёт 7 дней, код — 5 минут.
Привязка по телефону работает только при `phone_claim_enabled=True` и только для записей без аккаунта;
после `unlink` флаг выключается, чтобы номер, введённый с ошибкой, не привязался снова. Привязка и отвязка
пишутся в `GET /api/audit/` (`invite.created|accepted|revoked`, `tenant.linked|unlinked`).
Телефоны хранятся в E.164 (`+998XXXXXXXXX`); `+998901234567`, `998901234567`, `90 123 45 67` равнозначны.
Аккаунты, созданные по SMS, входят только по SMS (пароля нет). Жильцу недоступны оплата и изменение договоров.

SMS: `SMS_BACKEND=console` печатает код в лог (dev), `eskiz` — отправка через Eskiz.uz (`portal/sms.py`,
см. раздел «SMS» ниже); свой бэкенд — `SMS_BACKEND=путь.к.Классу` (наследник `SmsBackend`).

```bash
# арендодатель: приглашение и QR
curl -X POST $API/tenants/1/invite/ -H "$AUTH"
#  -> {"url":"https://app.example.com/join/<token>","expires_at":"..."}
curl "$API/tenants/1/invite/qr/?token=<token>" -H "$AUTH" -o invite.svg
curl -X POST $API/tenants/1/unlink/ -H "$AUTH"

# жилец: превью, регистрация по приглашению, либо принятие уже вошедшим жильцом
curl $API/invites/<token>/
curl -X POST $API/auth/register-tenant/ -H 'Content-Type: application/json'   -d '{"email":"tenant@example.com","password":"Str0ng-pass-987","token":"<token>"}'
curl -X POST $API/invites/accept/ -H "Authorization: Bearer $TENANT_TOKEN" -H 'Content-Type: application/json'   -d '{"token":"<token>"}'

# жилец: вход по телефону
curl -X POST $API/auth/phone/request/ -H 'Content-Type: application/json' -d '{"phone":"90 123 45 67"}'
curl -X POST $API/auth/phone/verify/  -H 'Content-Type: application/json' -d '{"phone":"+998901234567","code":"123456"}'

# жилец: свои данные
curl $API/tenant/leases/ -H "Authorization: Bearer $TENANT_TOKEN"
curl "$API/tenant/payments/?status=overdue" -H "Authorization: Bearer $TENANT_TOKEN"
```

## 🤖 Напоминания и Telegram

Celery beat ежедневно в 09:00 (Ташкент): арендатору — за 3 дня до срока, в день срока и при просрочке
(на 1-й, 4-й, 7-й… день); владельцу — одна сводка. Каждая отправка пишется в `NotificationLog`
с уникальным ключом — повторный запуск не дублирует сообщения, неудачные пробуются снова.
Шаблоны ru/uz — `reminders/messages.py`.

Привязка: владелец вызывает `POST /api/tenants/{id}/link-code/` (или `/api/me/telegram-link/` для себя),
отправляет код боту: `/start КОД`. Команды арендатора: `/balance`, `/pay_info`.
Реквизиты для `/pay_info` — поле `payment_details` в `/api/me/`.

## 💳 Платежи Payme и Click

- `POST /api/payments/{id}/invoice/` возвращает `payme_url` и `click_url` (если заданы ключи).
- Payme: JSON-RPC на `/api/webhooks/payme/`, аккаунт `{"payment_id": …}`, суммы в тийинах, Basic `Paycom:<PAYME_KEY>`.
- Click: Prepare/Complete на `/api/webhooks/click/`, подпись MD5 проверяется, `merchant_trans_id` = id платежа.
- Идемпотентность: уникальный `(provider, external_id)` + `select_for_update`; повторный вебхук не зачисляет деньги дважды.

## 📌 Допущения

- Даты оплаты: каждое `payment_day`-е число, начиная со `start_date`, строго до `end_date`. Если договор
  начат после `payment_day`, первая оплата — в следующем месяце.
- Завершение договора удаляет будущие платежи без оплат и попыток оплаты; просроченные остаются как долг.
- В отчёте доход = оплаты периода минус возвраты, сделанные в периоде (возврат в другом периоде даёт там отрицательный доход).
- Файлы не раздаются как `/media/`: только через `/api/documents/{id}/download/` с проверкой владельца
  (для S3 — редирект на подписанную ссылку на 5 минут).

## 🚢 Продакшен и HTTPS

Нужен сервер с Docker, DNS-запись домена на этот сервер и открытые порты 80 и 443.

1. `cp .env.example .env` — задайте `DOMAIN`, `LETSENCRYPT_EMAIL`, `POSTGRES_PASSWORD`.
2. `cp backend/.env.example backend/.env` — задайте `SECRET_KEY`, ключи Payme/Click, `TELEGRAM_BOT_TOKEN`,
   `ESKIZ_*`, `EMAIL_*`. Случайные `SECRET_KEY` и `POSTGRES_PASSWORD` выдаёт `./scripts/gen-secrets.sh`.
   `ALLOWED_HOSTS`, `CORS_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL` и `DATABASE_URL` compose выводит
   из корневого `.env` сам (они перекрывают `backend/.env`).
3. `./scripts/init-letsencrypt.sh` — один раз: выпускает сертификат и запускает весь стек.
   Дальше certbot продлевает сертификат сам, nginx подхватывает его раз в 12 часов.
4. Фронтенд собирается внутрь образа nginx (`nginx/Dockerfile`) и работает с API на том же домене.
   После изменений интерфейса: `docker compose up -d --build nginx`.
5. Файлы: по умолчанию лежат в томе `media`. Для надёжности задайте `AWS_*` (S3/R2) — тогда
   `scripts/backup.sh` сохраняет только БД, а копии файлов остаются на стороне хранилища.
6. Бэкапы: `0 3 * * * cd /srv/rent && ./scripts/backup.sh /srv/backups` в cron.
7. Webhook'и платежей: Payme — `https://<DOMAIN>/api/webhooks/payme/`, Click — `https://<DOMAIN>/api/webhooks/click/`.

## 📈 API-документация и мониторинг

- **OpenAPI/Swagger:** `/api/docs/` и `/api/schema/` (в dev включены; в проде — `API_DOCS_ENABLED=True`).
- **Проверка живости:** `GET /api/health/` — `200` или `503` (БД и кэш), без авторизации.
- **Sentry:** задайте `SENTRY_DSN` (в prod). Персональные данные не отправляются.
- **Бэкапы:** `scripts/backup.sh` — дамп PostgreSQL и файлов, хранит 14 последних копий (запуск из cron).

## 🔑 Сброс пароля

`POST /api/auth/password-reset/` `{email}` — всегда 200 (не раскрывает, есть ли аккаунт); письмо со ссылкой
`<FRONTEND_URL>/reset-password/<uid>/<token>`. `POST /api/auth/password-reset/confirm/` `{uid, token, password}`.
Токен одноразовый. Почта настраивается `EMAIL_*` (по умолчанию письма печатаются в консоль).

## 📱 SMS-вход жильца

`SMS_BACKEND=eskiz` + `ESKIZ_EMAIL`, `ESKIZ_PASSWORD` (`ESKIZ_FROM`, по умолчанию `4546`). Токен Eskiz
кэшируется и обновляется сам; сбои отправки не скрываются. Для разработки — `console` (код в лог).

## 💸 Пеня за просрочку

В договоре: `penalty_percent_per_day` (0–10, по умолчанию 0 = выключена) и `penalty_cap_percent` (0–100,
по умолчанию 100). В платежах: `days_overdue` и `penalty` (процент от текущего остатка за каждый день,
не выше лимита, округление вниз). Пеня **информационная**: в `amount_due` и в оплату через Payme/Click
не входит — владелец взыскивает её отдельно.

---

<div align="center">

Сделано с ❤️ в Узбекистане 🇺🇿 · Django + React

<img src="https://capsule-render.vercel.app/api?type=waving&height=100&color=0:EC4899,50:8B5CF6,100:6366F1&section=footer" width="100%" alt=""/>

</div>
