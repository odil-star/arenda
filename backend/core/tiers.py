"""Тарифные уровни: Free < Prime < VIP.

Без подписки, а также после окончания оплаченного срока, арендодатель — на Free. Free сохраняет всё, что есть в
продукте сейчас; Prime и VIP только добавляют эксклюзивные возможности, ничего у Free не отнимая.
"""
from datetime import date

from django.db.models import Q

from .models import Plan, Subscription

ORDER = (Plan.Tier.FREE, Plan.Tier.PRIME, Plan.Tier.VIP)


def tier_info(user) -> dict:
    """Текущий тариф пользователя: {"tier", "name", "paid_until", "expired"}."""
    sub = getattr(user, "subscription", None) if getattr(user, "pk", None) else None
    if sub is None:
        return {"tier": Plan.Tier.FREE, "name": None, "paid_until": None, "expired": False, "manager": None}
    expired = bool(sub.paid_until and sub.paid_until < date.today())
    tier = Plan.Tier.FREE if expired else sub.plan.tier
    manager = None
    if tier == Plan.Tier.VIP and (sub.manager_name or sub.manager_contact):
        manager = {"name": sub.manager_name, "contact": sub.manager_contact}
    return {"tier": tier, "name": sub.plan.name, "paid_until": sub.paid_until, "expired": expired, "manager": manager}


def has_tier(user, minimum: str) -> bool:
    """Хватает ли тарифа пользователя для возможности уровня `minimum` — для гейтинга эксклюзивных функций."""
    return ORDER.index(tier_info(user)["tier"]) >= ORDER.index(minimum)


def owner_ids_with_tier(minimum: str) -> set:
    """id арендодателей с действующим тарифом не ниже `minimum` — одним запросом, для массовых рассылок и выдачи."""
    allowed = ORDER[ORDER.index(minimum):]
    live = Q(paid_until__isnull=True) | Q(paid_until__gte=date.today())
    return set(Subscription.objects.filter(live, plan__tier__in=allowed).values_list("user_id", flat=True))
