# Контекст сборки — корень репозитория (см. docker-compose.yml).
# Этап 1: собираем фронтенд. Пустой VITE_API_URL = API на том же домене (/api/...).
FROM node:22 AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_URL=
RUN npm run build

# Этап 2: nginx раздаёт фронтенд и проксирует /api и /admin в Django.
FROM nginx:1.27
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
# Раз в 12 часов перечитываем сертификаты (certbot обновляет их в общем томе).
COPY --chmod=755 nginx/40-reload-certs.sh /docker-entrypoint.d/40-reload-certs.sh
