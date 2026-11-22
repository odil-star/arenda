"""Логика бота без привязки к aiogram — синхронная, тестируется напрямую."""
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from leasing.models import Lease, Payment, Tenant
from users.models import User

from .messages import money, t


def _language(chat_id):
    tenant = Tenant.objects.filter(telegram_chat_id=chat_id).only("language").first()
    if tenant:
        return tenant.language
    owner = User.objects.filter(telegram_chat_id=chat_id).only("language").first()
    return owner.language if owner else "ru"


def link(code, chat_id):
    """Привязать чат по одноразовому коду (арендатор — «T…», владелец — «O…»)."""
    code = (code or "").strip().upper()
    now = timezone.now()
    if not code:
        return t("ru", "need_link")
    if code.startswith("T"):
        with transaction.atomic():
            tenant = (Tenant.objects.select_for_update()
                      .filter(link_code=code, link_code_expires_at__gt=now).first())
            if tenant is None:
                return t("ru", "unknown_code")
            tenant.telegram_chat_id = chat_id
            tenant.link_code = None
            tenant.link_code_expires_at = None
            tenant.save(update_fields=["telegram_chat_id", "link_code", "link_code_expires_at", "updated_at"])
            if tenant.user_id:  # один аккаунт жильца — все его записи у разных арендодателей
                Tenant.objects.filter(user_id=tenant.user_id).update(telegram_chat_id=chat_id)
            return t(tenant.language, "linked_tenant", name=tenant.full_name)
    if code.startswith("O"):
        try:
            with transaction.atomic():
                user = (User.objects.select_for_update()
                        .filter(telegram_link_code=code, telegram_link_expires_at__gt=now).first())
                if user is None:
                    return t("ru", "unknown_code")
                user.telegram_chat_id = chat_id
                user.telegram_link_code = None
                user.telegram_link_expires_at = None
                user.save(update_fields=["telegram_chat_id", "telegram_link_code", "telegram_link_expires_at"])
                return t(user.language, "linked_owner")
        except IntegrityError:
            return t("ru", "chat_taken")
    return t("ru", "unknown_code")


def _active_leases(chat_id):
    return (Lease.objects.filter(tenant__telegram_chat_id=chat_id, status=Lease.Status.ACTIVE)
            .select_related("property", "owner", "tenant"))


def balance_text(chat_id):
    leases = list(_active_leases(chat_id))
    if not leases:
        return t(_language(chat_id), "need_link")
    lang = leases[0].tenant.language
    unpaid = defaultdict_list(
        Payment.objects.filter(lease__in=leases, amount_paid__lt=F("amount_due")).order_by("due_date")
    )
    today = timezone.localdate()
    blocks = []
    for lease in leases:
        rows = unpaid.get(lease.pk, [])
        lines = [t(lang, "balance_title", property=lease.property.name)]
        overdue = sum(p.remaining for p in rows if p.due_date < today)
        upcoming = next((p for p in rows if p.due_date >= today), None)
        if overdue:
            lines.append(t(lang, "balance_overdue", amount=money(overdue)))
        if upcoming:
            lines.append(t(lang, "balance_next", amount=money(upcoming.remaining),
                           due=upcoming.due_date.strftime("%d.%m.%Y")))
        if not overdue and not upcoming:
            lines.append(t(lang, "balance_clear"))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def pay_info_text(chat_id):
    leases = list(_active_leases(chat_id))
    if not leases:
        return t(_language(chat_id), "need_link")
    lang = leases[0].tenant.language
    unpaid = defaultdict_list(
        Payment.objects.filter(lease__in=leases, amount_paid__lt=F("amount_due")).order_by("due_date")
    )
    blocks = []
    for lease in leases:
        lines = [t(lang, "pay_info_title", property=lease.property.name)]
        rows = unpaid.get(lease.pk, [])
        if rows:
            lines.append(t(lang, "pay_info_amount", amount=money(rows[0].remaining)))
        details = lease.get_payment_details()
        lines.append(details if details else t(lang, "pay_info_none"))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def defaultdict_list(payments):
    grouped = {}
    for payment in payments:
        grouped.setdefault(payment.lease_id, []).append(payment)
    return grouped
