"""VIP: проверка жильца — обезличенная платёжная репутация по платформе.

Принципы приватности:
- только с согласия жильца (он сам включает «Делиться надёжностью» в своём кабинете, по умолчанию выключено)
  и только для жильца с подтверждённым аккаунтом, а не для любой записи с введённым вручную телефоном;
- наружу — только агрегаты (сколько платежей вовремя, сколько просрочено) и общий вывод; без названий объектов,
  адресов, имён и контактов других арендодателей;
- каждая проверка записывается в журнал действий владельца.
"""
from datetime import timedelta

from django.utils import timezone

from .models import Payment

GRACE_DAYS = 3  # оплата в пределах этих дней после срока считается вовремя
MIN_PAYMENTS = 3  # меньше — вывод делать рано


def _local_date(moment):
    return timezone.localtime(moment).date()


def reliability(user, today=None) -> dict:
    """Платёжная история пользователя (жильца) по всем арендодателям платформы: агрегаты и вывод."""
    today = today or timezone.localdate()
    rows = list(
        Payment.objects.filter(lease__tenant__user=user, due_date__lt=today)
        .values("due_date", "amount_due", "amount_paid", "paid_at", "lease_id", "owner_id")
    )
    on_time = late = overdue = 0
    for row in rows:
        if row["amount_paid"] >= row["amount_due"]:
            paid_on = _local_date(row["paid_at"]) if row["paid_at"] else row["due_date"]
            if paid_on <= row["due_date"] + timedelta(days=GRACE_DAYS):
                on_time += 1
            else:
                late += 1
        else:
            overdue += 1
    total = on_time + late + overdue
    if total < MIN_PAYMENTS:
        verdict = "not_enough"
    else:
        rate = on_time / total
        if overdue == 0 and rate >= 0.9:
            verdict = "reliable"
        elif rate >= 0.7 and overdue <= 1:
            verdict = "mostly"
        else:
            verdict = "risky"
    months = 0
    if rows:
        first = min(r["due_date"] for r in rows)
        months = max(1, (today.year - first.year) * 12 + today.month - first.month)
    return {
        "verdict": verdict,
        "payments": total,
        "on_time": on_time,
        "late": late,
        "overdue": overdue,
        "leases": len({r["lease_id"] for r in rows}),
        "landlords": len({r["owner_id"] for r in rows}),  # сколько арендодателей — число, без личностей
        "months": months,
        "grace_days": GRACE_DAYS,
    }
