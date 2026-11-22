from celery import shared_task

from .services import run_daily_reminders


@shared_task
def send_daily_reminders():
    return run_daily_reminders()
