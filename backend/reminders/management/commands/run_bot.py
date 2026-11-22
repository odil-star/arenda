import asyncio

from django.core.management.base import BaseCommand

from reminders.bot import run_polling


class Command(BaseCommand):
    help = "Запустить Telegram-бота (long polling)"

    def handle(self, *args, **options):
        asyncio.run(run_polling())
