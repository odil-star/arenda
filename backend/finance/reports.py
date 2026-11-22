import csv
import io
from datetime import datetime, time, timedelta

from django.db.models import Sum
from django.utils import timezone

from leasing.models import PaymentTransaction, Property

from .models import Expense


def default_period(today=None):
    today = today or timezone.localdate()
    return today.replace(day=1), today


def build_report(owner, date_from, date_to, property_id=None):
    """Доход = оплаты периода минус возвраты, сделанные в периоде (возврат может быть и в другом
    периоде — тогда доход того периода отрицательный). Расход — по дате расхода."""
    start = timezone.make_aware(datetime.combine(date_from, time.min))
    end = timezone.make_aware(datetime.combine(date_to + timedelta(days=1), time.min))
    base = PaymentTransaction.objects.filter(owner=owner)
    State = PaymentTransaction.State
    # Оплаты, проведённые в периоде (в т.ч. позже возвращённые), и возвраты, сделанные в периоде.
    gross_qs = base.filter(state__in=[State.COMPLETED, State.REFUNDED], performed_at__gte=start, performed_at__lt=end)
    refund_qs = base.filter(state=State.REFUNDED, cancelled_at__gte=start, cancelled_at__lt=end)
    expense_qs = Expense.objects.filter(owner=owner, expense_date__gte=date_from, expense_date__lte=date_to)
    if property_id:
        gross_qs = gross_qs.filter(payment__lease__property_id=property_id)
        refund_qs = refund_qs.filter(payment__lease__property_id=property_id)
        expense_qs = expense_qs.filter(property_id=property_id)

    gross = dict(gross_qs.values_list("payment__lease__property_id").annotate(s=Sum("amount")))
    refunds = dict(refund_qs.values_list("payment__lease__property_id").annotate(s=Sum("amount")))
    income = {pid: gross.get(pid, 0) - refunds.get(pid, 0) for pid in set(gross) | set(refunds)}
    expenses = dict(expense_qs.values_list("property_id").annotate(s=Sum("amount")))
    by_category = {c: s for c, s in expense_qs.values_list("category").annotate(s=Sum("amount"))}
    ids = set(income) | set(expenses)
    names = dict(Property.objects.filter(owner=owner, pk__in=ids).values_list("pk", "name"))
    rows = [
        {"property": pid, "name": names.get(pid, "—"), "income": income.get(pid, 0),
         "refunds": refunds.get(pid, 0), "expenses": expenses.get(pid, 0), "profit": income.get(pid, 0) - expenses.get(pid, 0)}
        for pid in sorted(ids, key=lambda i: names.get(i, ""))
    ]
    total_income, total_expenses = sum(income.values()), sum(expenses.values())
    return {
        "date_from": date_from, "date_to": date_to,
        "income": total_income, "refunds": sum(refunds.values()), "expenses": total_expenses, "profit": total_income - total_expenses,
        "by_property": rows,
        "expenses_by_category": [{"category": c, "amount": a} for c, a in sorted(by_category.items())],
    }


def _safe(value):
    """Защита от формул в Excel/CSV: текст, начинающийся с = + - @, считается текстом."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


HEADER = ["Объект", "Доход, сум", "Расходы, сум", "Прибыль, сум"]


def _table(report):
    rows = [[_safe(r["name"]), r["income"], r["expenses"], r["profit"]] for r in report["by_property"]]
    rows.append(["ИТОГО", report["income"], report["expenses"], report["profit"]])
    return rows


def to_csv(report):
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow([f"Период: {report['date_from']:%d.%m.%Y} — {report['date_to']:%d.%m.%Y}"])
    writer.writerow(HEADER)
    writer.writerows(_table(report))
    return ("﻿" + buffer.getvalue()).encode("utf-8")  # BOM, чтобы Excel узнал UTF-8


def to_xlsx(report):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Отчёт"
    ws.append([f"Период: {report['date_from']:%d.%m.%Y} — {report['date_to']:%d.%m.%Y}"])
    ws.append(HEADER)
    for row in _table(report):
        ws.append(row)
    ws.column_dimensions["A"].width = 32
    for col in "BCD":
        ws.column_dimensions[col].width = 18
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
