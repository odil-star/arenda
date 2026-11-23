from django.template.loader import render_to_string
from django.utils import timezone

from reminders.messages import money

from .contract import PdfUnavailable


def render_receipt_html(payment):
    lease = payment.lease
    return render_to_string("leasing/payment_receipt.html", {
        "payment": payment, "lease": lease, "owner": payment.owner, "tenant": lease.tenant,
        "property": lease.property, "due": money(payment.amount_due), "paid": money(payment.amount_paid),
        "remaining": money(payment.remaining), "fully_paid": payment.remaining <= 0,
        "today": timezone.localdate(),
    })


def render_receipt_pdf(payment):
    try:
        from weasyprint import HTML
    except (ImportError, OSError) as exc:
        raise PdfUnavailable("Генерация PDF недоступна на сервере.") from exc
    return HTML(string=render_receipt_html(payment)).write_pdf()
