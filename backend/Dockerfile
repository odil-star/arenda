FROM python:3.12-slim

# Библиотеки для WeasyPrint (Pango/Cairo) и шрифты с кириллицей
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libffi-dev shared-mime-info fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 DJANGO_SETTINGS_MODULE=config.settings.prod
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd -m app && mkdir -p /app/media /app/staticfiles && chown -R app /app/media /app/staticfiles
USER app
CMD ["gunicorn", "config.wsgi", "-b", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
