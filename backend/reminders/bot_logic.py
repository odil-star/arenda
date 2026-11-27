"""Логика бота без привязки к aiogram — синхронная, тестируется напрямую."""
from datetime import timedelta

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
    raw = (code or "").strip()
    if raw[:2].lower() == "s_":
        return link_saved_search(raw[2:], chat_id)
    code = raw.upper()
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


def link_saved_search(token, chat_id):
    """Привязать чат к сохранённому поиску с сайта; уже существующие объявления считаем «виденными»."""
    from leasing.listings import apply_filters, available_properties
    from leasing.models import SavedSearch

    with transaction.atomic():
        search = SavedSearch.objects.select_for_update().filter(token=token.lower(), is_active=True).first()
        if search is None:
            return t("ru", "search_unknown")
        search.chat_id = chat_id
        search.seen_ids = list(apply_filters(available_properties(), search.filters).values_list("pk", flat=True))
        search.save(update_fields=["chat_id", "seen_ids"])
        return t(search.language, "search_linked")


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


def link_by_phone(chat_id, phone_raw):
    """Привязка по номеру, который жилец сам подтвердил в Telegram («Поделиться номером»), без кода.

    Подходят записи арендатора с этим номером, у которых ещё нет Telegram. Если у записи есть аккаунт в приложении,
    он должен быть создан входом по этому же номеру (SMS) — иначе номер, введённый арендодателем, ничего
    не доказывает, и такой жилец привязывается кнопкой на сайте или кодом."""
    from core.phone import try_normalize_phone
    from portal.services import phone_email

    phone = try_normalize_phone(phone_raw)
    if phone is None:
        return t("ru", "phone_not_found")
    if Tenant.objects.filter(telegram_chat_id=chat_id).exists() or User.objects.filter(telegram_chat_id=chat_id).exists():
        return t(_language(chat_id), "phone_already")
    with transaction.atomic():
        rows = list(Tenant.objects.select_for_update(of=("self",)).filter(phone=phone, telegram_chat_id__isnull=True)
                    .select_related("user"))
        if not rows:
            return t("ru", "phone_not_found")
        allowed = [r for r in rows if r.user_id is None or r.user.email == phone_email(phone)]
        if not allowed:
            return t(rows[0].language, "phone_needs_site")
        Tenant.objects.filter(pk__in=[r.pk for r in allowed]).update(telegram_chat_id=chat_id)
        return t(allowed[0].language, "linked_tenant", name=allowed[0].full_name)


def is_tenant(chat_id):
    return Tenant.objects.filter(telegram_chat_id=chat_id).exists()


def language_of(chat_id):
    return _language(chat_id)


def unlink(chat_id):
    """Отвязать чат от всех записей арендатора и от владельца."""
    lang = _language(chat_id)
    Tenant.objects.filter(telegram_chat_id=chat_id).update(telegram_chat_id=None)
    User.objects.filter(telegram_chat_id=chat_id).update(telegram_chat_id=None)
    from leasing.models import SavedSearch
    SavedSearch.objects.filter(chat_id=chat_id).update(is_active=False)
    return t(lang, "unlinked")


def _error_reason(exc):
    detail = exc.detail
    if isinstance(detail, dict):
        detail = [item for value in detail.values() for item in (value if isinstance(value, list) else [value])]
    elif not isinstance(detail, list):
        detail = [detail]
    return " ".join(str(item) for item in detail)


def receivable_payments(chat_id):
    """Платежи арендатора, к которым сейчас можно приложить чек. Возвращает (язык, список) или (язык, None),
    если чат привязан, но у жильца нет аккаунта в приложении (чек от его имени отправить нельзя)."""
    from portal.models import PaymentReceipt
    from portal.receipts import month_reached

    lang = _language(chat_id)
    tenants = Tenant.objects.filter(telegram_chat_id=chat_id)
    if not tenants.exists():
        return lang, []
    payments = (Payment.objects.filter(lease__tenant__telegram_chat_id=chat_id, lease__status=Lease.Status.ACTIVE,
                                       amount_paid__lt=F("amount_due"))
                .select_related("lease__property", "lease__tenant").order_by("due_date"))
    pending = set(PaymentReceipt.objects.filter(payment__in=payments, status=PaymentReceipt.Status.PENDING)
                  .values_list("payment_id", flat=True))
    rows = [p for p in payments if p.pk not in pending and month_reached(p)]
    if rows and all(p.lease.tenant.user_id is None for p in rows):
        return lang, None
    return lang, [p for p in rows if p.lease.tenant.user_id is not None]


def payment_prompt(chat_id, payment_id):
    """Текст «пришлите чек» для платежа, выбранного кнопкой под напоминанием (None — платёж чужой)."""
    payment = (Payment.objects.filter(pk=payment_id, lease__tenant__telegram_chat_id=chat_id)
               .select_related("lease__property", "lease__tenant").first())
    if payment is None:
        return None
    return t(payment.lease.tenant.language, "send_receipt_now", property=payment.lease.property.name,
             amount=money(payment.remaining))


def payment_choice_lines(chat_id, payments):
    lang = _language(chat_id)
    return [(p.pk, t(lang, "receipt_choice_line", property=p.lease.property.name, amount=money(p.remaining),
                     due=p.due_date.strftime("%d.%m.%Y"))) for p in payments]


def submit_tenant_receipt(chat_id, payment_id, content, filename):
    """Жилец прислал файл чека в бот. Использует тот же сервис, что и сайт, — те же проверки."""
    from django.core.files.base import ContentFile
    from rest_framework.exceptions import ValidationError

    from portal.receipts import submit_receipt

    lang = _language(chat_id)
    payment = (Payment.objects.filter(pk=payment_id, lease__tenant__telegram_chat_id=chat_id)
               .select_related("lease__property", "lease__tenant").first())
    if payment is None or payment.lease.tenant.user_id is None:
        return t(lang, "receipt_no_payment")
    file = ContentFile(content, name=filename)
    try:
        receipt = submit_receipt(user=payment.lease.tenant.user, payment_id=payment.pk, file=file)
    except ValidationError as exc:
        return t(lang, "receipt_error", reason=_error_reason(exc))
    return t(lang, "receipt_sent", property=payment.lease.property.name, amount=money(receipt.amount))


def review_receipt(chat_id, receipt_id, approve):
    """Владелец нажал «Принять/Отклонить» под уведомлением. Возвращает (ответ владельцу, [(chat_id, текст)])."""
    from rest_framework.exceptions import ValidationError

    from portal.models import PaymentReceipt
    from portal.receipts import confirm_receipt, reject_receipt

    owner = User.objects.filter(telegram_chat_id=chat_id).first()
    if owner is None:
        return t("ru", "receipt_owner_only"), []
    lang = owner.language
    receipt = (PaymentReceipt.objects.filter(pk=receipt_id, owner=owner)
               .select_related("payment__lease__property", "payment__lease__tenant").first())
    if receipt is None:
        return t(lang, "receipt_processed"), []
    try:
        if approve:
            confirm_receipt(receipt_id=receipt.pk, owner=owner, actor=owner)
        else:
            reject_receipt(receipt_id=receipt.pk, owner=owner, actor=owner)
    except ValidationError:
        return t(lang, "receipt_processed"), []
    tenant = receipt.payment.lease.tenant
    params = dict(tenant=tenant.full_name, amount=money(receipt.amount), property=receipt.payment.lease.property.name)
    notices = []
    if tenant.telegram_chat_id is not None:
        notices.append((tenant.telegram_chat_id,
                        t(tenant.language, "receipt_ok_tenant" if approve else "receipt_no_tenant", **params)))
    return t(lang, "receipt_ok_owner" if approve else "receipt_no_owner", **params), notices


def _owner(chat_id):
    return User.objects.filter(telegram_chat_id=chat_id).first()


def history_text(chat_id):
    """Последние платежи арендатора: оплачено / частично / долг."""
    leases = list(_active_leases(chat_id))
    if not leases:
        return t(_language(chat_id), "need_link")
    lang = leases[0].tenant.language
    today = timezone.localdate()
    blocks = []
    for lease in leases:
        rows = list(lease.payments.filter(due_date__lte=today + timedelta(days=31)).order_by("-due_date")[:8])
        lines = [t(lang, "balance_title", property=lease.property.name)]
        for p in rows:
            mark = "✅" if p.remaining <= 0 else ("🟡" if p.amount_paid else ("🔴" if p.due_date < today else "⚪"))
            lines.append(f"{mark} {p.due_date.strftime('%d.%m.%Y')} — {money(p.amount_paid)} / {money(p.amount_due)}")
        if not rows:
            lines.append(t(lang, "history_empty"))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def lease_text(chat_id):
    leases = list(_active_leases(chat_id))
    if not leases:
        return t(_language(chat_id), "need_link")
    lang = leases[0].tenant.language
    blocks = []
    for lease in leases:
        blocks.append(t(lang, "lease_card", property=lease.property.name, address=lease.property.address,
                        rent=money(lease.rent_amount), day=lease.payment_day,
                        start=lease.start_date.strftime("%d.%m.%Y"), end=lease.end_date.strftime("%d.%m.%Y"),
                        left=max((lease.end_date - timezone.localdate()).days, 0)))
    return "\n\n".join(blocks)


def debtors_text(chat_id):
    """Владельцу: кто и сколько должен."""
    owner = _owner(chat_id)
    if owner is None:
        return t("ru", "receipt_owner_only")
    today = timezone.localdate()
    rows = (Payment.objects.filter(owner=owner, lease__status=Lease.Status.ACTIVE, due_date__lt=today,
                                   amount_paid__lt=F("amount_due"))
            .select_related("lease__tenant", "lease__property").order_by("due_date"))
    grouped = {}
    for p in rows:
        grouped.setdefault((p.lease.tenant.full_name, p.lease.property.name), []).append(p)
    if not grouped:
        return t(owner.language, "debtors_none")
    lines = [t(owner.language, "debtors_title", count=len(grouped))]
    total = 0
    for (tenant, prop), items in list(grouped.items()):
        amount = sum(p.remaining for p in items)
        total += amount
        lines.append(t(owner.language, "debtors_line", tenant=tenant, property=prop, amount=money(amount),
                       days=(today - items[0].due_date).days))
    lines.append(t(owner.language, "debtors_total", amount=money(total)))
    return "\n".join(lines[:40])


def income_text(chat_id):
    """Владельцу: сколько получено в этом месяце и сколько ещё ждём."""
    from leasing.models import PaymentTransaction

    owner = _owner(chat_id)
    if owner is None:
        return t("ru", "receipt_owner_only")
    today = timezone.localdate()
    received = sum(PaymentTransaction.objects.filter(
        owner=owner, state=PaymentTransaction.State.COMPLETED,
        performed_at__year=today.year, performed_at__month=today.month).values_list("amount", flat=True))
    month = Payment.objects.filter(owner=owner, lease__status=Lease.Status.ACTIVE,
                                   due_date__year=today.year, due_date__month=today.month)
    expected = sum(month.values_list("amount_due", flat=True))
    left = sum(p.remaining for p in month)
    return t(owner.language, "income_card", month=today.strftime("%m.%Y"), received=money(received),
             expected=money(expected), left=money(left))


def pending_receipts(chat_id):
    """Владельцу: чеки на проверке, каждый с кнопками. Возвращает [(receipt_id, текст)] и язык."""
    from portal.models import PaymentReceipt

    owner = _owner(chat_id)
    if owner is None:
        return "ru", None
    rows = (PaymentReceipt.objects.filter(owner=owner, status=PaymentReceipt.Status.PENDING)
            .select_related("payment__lease__tenant", "payment__lease__property").order_by("created_at")[:10])
    return owner.language, [(r.pk, t(owner.language, "owner_receipt", tenant=r.payment.lease.tenant.full_name,
                                     property=r.payment.lease.property.name, amount=money(r.amount))) for r in rows]


def is_owner(chat_id):
    return User.objects.filter(telegram_chat_id=chat_id).exists()


def defaultdict_list(payments):
    grouped = {}
    for payment in payments:
        grouped.setdefault(payment.lease_id, []).append(payment)
    return grouped
