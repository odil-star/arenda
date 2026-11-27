"""Prime: итоги прошлого месяца — сами приходят арендодателю в Telegram и на почту."""
import logging
from datetime import timedelta

from django.core.mail import send_mail
from django.db.models import Count, F, Sum
from django.utils import timezone

from core.tiers import owner_ids_with_tier
from leasing.models import Lease, Payment, Property
from users.models import User

from .channels import get_sender
from .messages import money, t
from .models import NotificationLog
from .services import deliver

logger = logging.getLogger(__name__)


class EmailSender:
    """Тот же deliver(), но сообщение уходит письмом. chat_id=0 — маркер не-Telegram канала."""

    def __init__(self, email, subject):
        self.email, self.subject = email, subject

    def send(self, chat_id, text, reply_markup=None):
        send_mail(self.subject, text, None, [self.email])


def previous_month(today):
    last = today.replace(day=1) - timedelta(days=1)
    return last.replace(day=1), last


def digest_text(owner, first, last, today):
    """Текст итогов за месяц [first, last]: начислено, получено, долги, загрузка объектов."""
    month = Payment.objects.filter(owner=owner, due_date__range=(first, last)).aggregate(
        expected=Sum("amount_due"), received=Sum("amount_paid"))
    expected, received = month["expected"] or 0, month["received"] or 0
    overdue = Payment.objects.filter(owner=owner, due_date__lt=today, amount_paid__lt=F("amount_due")).aggregate(
        n=Count("pk"), total=Sum(F("amount_due") - F("amount_paid")))
    props = Property.objects.filter(owner=owner).count()
    busy = Lease.objects.filter(owner=owner, status=Lease.Status.ACTIVE).values("property").distinct().count()
    lang = owner.language
    lines = [
        t(lang, "digest_header", month=f"{first.month:02d}.{first.year}"),
        t(lang, "digest_money", received=money(received), expected=money(expected)),
        t(lang, "digest_overdue", count=overdue["n"], amount=money(overdue["total"] or 0)),
        t(lang, "digest_props", busy=busy, total=props),
    ]
    return "\n".join(lines)


def run_monthly_digest(today=None, sender=None):
    """1-го числа: итоги прошлого месяца владельцам с тарифом Prime и выше. Повторный запуск дублей не шлёт."""
    today = today or timezone.localdate()
    sender = sender or get_sender()
    first, last = previous_month(today)
    stats = {"telegram": 0, "email": 0}
    for owner in User.objects.filter(pk__in=owner_ids_with_tier("prime")):
        text = digest_text(owner, first, last, today)
        key = f"digest:{owner.pk}:{first.isoformat()}"
        if owner.telegram_chat_id is not None and deliver(
            sender, owner=owner, kind=NotificationLog.Kind.OWNER_SUMMARY, dedupe_key=key,
            chat_id=owner.telegram_chat_id, text=text,
        ):
            stats["telegram"] += 1
        if owner.email and not owner.email.endswith(".invalid") and deliver(
            EmailSender(owner.email, t(owner.language, "digest_subject")), owner=owner,
            kind=NotificationLog.Kind.OWNER_SUMMARY, dedupe_key=f"mail:{key}", chat_id=0, text=text,
        ):
            stats["email"] += 1
    return stats
