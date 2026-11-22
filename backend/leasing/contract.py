from django.template.loader import render_to_string
from django.utils import timezone

from reminders.messages import money


class PdfUnavailable(Exception):
    pass


def render_contract_html(lease):
    payments = [
        {"due_date": p.due_date, "amount_due_text": money(p.amount_due)}
        for p in lease.payments.order_by("due_date")
    ]
    inventory = [line.strip(" 	-•*") for line in lease.inventory.splitlines()]
    inventory = [line for line in inventory if line]
    return render_to_string("leasing/contract.html", {
        "lease": lease, "owner": lease.owner, "tenant": lease.tenant, "property": lease.property,
        "rent": money(lease.rent_amount), "deposit": money(lease.deposit_amount),
        "payments": payments, "inventory": inventory, "today": timezone.localdate(),
    })


def render_contract_pdf(lease):
    try:
        from weasyprint import HTML  # тяжёлая зависимость: Pango/Cairo ставятся в Docker-образ
    except (ImportError, OSError) as exc:
        raise PdfUnavailable("Генерация PDF недоступна на сервере.") from exc
    return HTML(string=render_contract_html(lease)).write_pdf()
