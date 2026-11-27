from celery import shared_task

from .digest import run_monthly_digest
from .services import run_daily_reminders


@shared_task
def send_daily_reminders():
    return run_daily_reminders()


@shared_task
def send_monthly_digest():
    return run_monthly_digest()
