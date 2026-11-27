"""Бизнес-логика приглашений, привязки жильцов и входа по SMS-коду."""
import hashlib
import hmac
import logging
import secrets

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.audit import log_action
from core.phone import try_normalize_phone
from leasing.models import Lease, Tenant
from users.models import User, UserProfile

from .models import Invite, PhoneOTP, hash_token
from .sms import get_sms_backend

logger = logging.getLogger(__name__)


PLACEHOLDER_NAME = "Жилец (по приглашению)"


class InvalidInvite(Exception):
    """Токена нет / просрочен / отозван / использован — снаружи всё выглядит одинаково (404)."""


class InvalidCode(Exception):
    """Неверный, просроченный или заблокированный код — снаружи всё выглядит одинаково."""


# ---------- приглашения ----------

def invite_url(token):
    return f"{settings.FRONTEND_URL}/join/{token}"


def revoke_active_invites(tenant, owner, actor, now=None):
    """Отзывает все неиспользованные неотозванные приглашения жильца."""
    now = now or timezone.now()
    for invite in Invite.objects.select_for_update().filter(tenant=tenant, used_at__isnull=True,
                                                            revoked_at__isnull=True):
        invite.revoked_at = now
        invite.save(update_fields=["revoked_at"])
        log_action(owner, "invite.revoked", invite, actor=actor, tenant=tenant.pk)


@transaction.atomic
def create_invite(*, tenant_id, owner, actor, property=None):
    """Новое приглашение; прежние активные отзываются. Возвращает (invite, token) — токен только здесь."""
    tenant = Tenant.objects.select_for_update().get(pk=tenant_id, owner=owner)
    if tenant.user_id is not None:
        raise ValidationError({"detail": ["Жилец уже привязан к аккаунту. Сначала отвяжите его."]})
    revoke_active_invites(tenant, owner, actor)
    token = secrets.token_urlsafe(32)
    invite = Invite.objects.create(tenant=tenant, created_by=actor, property=property,
                                    token_hash=hash_token(token))
    log_action(owner, "invite.created", invite, actor=actor, tenant=tenant.pk)
    return invite, token


def tenant_for_property_invite(prop, owner):
    """Жилец действующего договора объекта; если договора нет — заготовка жильца, который заполнит данные сам."""
    lease = prop.leases.filter(status=Lease.Status.ACTIVE).select_related("tenant").first()
    if lease is not None:
        return lease.tenant
    placeholder = Tenant.objects.filter(
        owner=owner, user__isnull=True, full_name=PLACEHOLDER_NAME, leases__isnull=True,
        invites__property=prop,
    ).first()
    return placeholder or Tenant.objects.create(owner=owner, full_name=PLACEHOLDER_NAME, phone_claim_enabled=False)


def find_invite(token, *, lock=False):
    """Активное приглашение по токену либо InvalidInvite (одинаково для любой причины)."""
    if not isinstance(token, str) or not (20 <= len(token) <= 200):
        raise InvalidInvite
    digest = hash_token(token)
    qs = Invite.objects.select_related("tenant", "tenant__owner")
    if lock:
        qs = qs.select_for_update(of=("self",))
    invite = qs.filter(token_hash=digest).first()
    if invite is None or not hmac.compare_digest(invite.token_hash, digest) or not invite.is_active:
        raise InvalidInvite
    return invite


def invite_qr_svg(token):
    """SVG-QR той же ссылки (отдельного токена у QR нет)."""
    import io

    import qrcode
    from qrcode.image.svg import SvgPathImage

    buffer = io.BytesIO()
    qrcode.make(invite_url(token), image_factory=SvgPathImage, box_size=10, border=2).save(buffer)
    return buffer.getvalue()


def landlord_name(owner):
    return owner.get_full_name() or "Арендодатель"  # email наружу не отдаём


def invite_preview(token):
    invite = find_invite(token)
    tenant = invite.tenant
    lease = (
        Lease.objects.filter(tenant=tenant).select_related("property")
        .order_by("status", "-start_date").first()  # "active" раньше "ended"
    )
    prop = invite.property or (lease.property if lease else None)
    return {
        "valid": True,
        "landlord_name": landlord_name(tenant.owner),
        "property_name": prop.name if prop else None,
        "needs_profile": tenant.full_name == PLACEHOLDER_NAME,  # жилец вводит имя и телефон сам
    }


def _link(tenant, user, *, method, now=None):
    now = now or timezone.now()
    tenant.user = user
    # Чат, привязанный к записи до появления аккаунта, мог привязать кто угодно (в т. ч. арендодатель) —
    # для уведомлений он остаётся, но входом в этот аккаунт не служит.
    tenant.telegram_login = False
    tenant.save(update_fields=["user", "telegram_login", "updated_at"])
    revoke_active_invites(tenant, tenant.owner, user, now)
    log_action(tenant.owner, "tenant.linked", tenant, actor=user, method=method, user=user.pk)


@transaction.atomic
def accept_invite(token, user, full_name="", phone=""):
    invite = find_invite(token, lock=True)
    tenant = Tenant.objects.select_for_update().get(pk=invite.tenant_id)
    if tenant.user_id is not None:
        raise InvalidInvite
    now = timezone.now()
    invite.used_at = now
    invite.save(update_fields=["used_at"])
    if tenant.full_name == PLACEHOLDER_NAME and (full_name or phone):
        # Жилец заполняет свои данные сам — только для заготовки; имена, заданные арендодателем, не трогаем.
        tenant.full_name = full_name or tenant.full_name
        tenant.phone = phone or tenant.phone
        tenant.save(update_fields=["full_name", "phone", "updated_at"])
    _link(tenant, user, method="invite", now=now)
    log_action(tenant.owner, "invite.accepted", invite, actor=user, tenant=tenant.pk)
    return tenant


@transaction.atomic
def unlink_tenant(*, tenant_id, owner, actor):
    tenant = Tenant.objects.select_for_update().get(pk=tenant_id, owner=owner)
    now = timezone.now()
    previous = tenant.user_id
    revoke_active_invites(tenant, owner, actor, now)
    # Использованные приглашения тоже закрываем: статус приглашения после отвязки — «none».
    Invite.objects.filter(tenant=tenant, revoked_at__isnull=True).update(revoked_at=now)
    if previous is None:
        return tenant
    tenant.user = None
    # Иначе тот же человек мгновенно привяжется снова по SMS (номер мог быть введён с ошибкой).
    tenant.phone_claim_enabled = False
    tenant.save(update_fields=["user", "phone_claim_enabled", "updated_at"])
    log_action(owner, "tenant.unlinked", tenant, actor=actor, user=previous)
    return tenant


def _make_tenant_role(user):
    profile = user.profile  # создан сигналом; правим именно этот объект, иначе user.profile останется устаревшим
    profile.role = UserProfile.Role.TENANT
    profile.save(update_fields=["role"])


def create_tenant_user(*, email, password, **extra):
    user = User.objects.create_user(email, password, **extra)
    _make_tenant_role(user)
    return user


# ---------- вход по телефону ----------

def _code_hash(phone, code):
    """HMAC с серверным ключом: 6-значный код без ключа подбирается из хэша мгновенно."""
    return hmac.new(settings.SECRET_KEY.encode(), f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def send_phone_code(phone):
    """Создаёт код (прежние коды номера аннулируются) и отправляет SMS. Ошибки отправки не раскрываются."""
    code = f"{secrets.randbelow(10**6):06d}"
    with transaction.atomic():
        PhoneOTP.objects.filter(phone=phone).delete()
        PhoneOTP.objects.create(phone=phone, code_hash=_code_hash(phone, code))
    try:
        get_sms_backend().send(phone, f"Код подтверждения: {code}. Никому его не сообщайте.")
    except Exception:  # noqa: BLE001 — ответ клиенту одинаков в любом случае
        logger.exception("Не удалось отправить SMS")


def phone_email(phone):
    """Служебный email аккаунта, созданного по номеру телефона."""
    return f"tel{phone.lstrip('+')}@phone.invalid"


def _phone_user(phone):
    email = phone_email(phone)
    user, created = User.objects.get_or_create(email=email, defaults={"phone": phone})
    if created:
        user.set_unusable_password()
        user.save(update_fields=["password"])
        _make_tenant_role(user)
    if not user.is_active or user.profile.role != UserProfile.Role.TENANT:
        raise InvalidCode
    return user


def verify_phone_code(raw_phone, code):
    """Проверяет код; при успехе возвращает User (созданного или найденного) и привязывает жильцов."""
    phone = try_normalize_phone(raw_phone)
    if phone is None or not isinstance(code, str):
        raise InvalidCode
    user = None
    with transaction.atomic():
        otp = PhoneOTP.objects.select_for_update().filter(phone=phone).first()
        if otp is None or otp.expires_at <= timezone.now() or otp.attempts >= PhoneOTP.MAX_ATTEMPTS:
            raise InvalidCode
        otp.attempts += 1  # считаем до проверки; сохраняется, т.к. исключение — ниже, вне atomic
        otp.save(update_fields=["attempts"])
        if hmac.compare_digest(otp.code_hash, _code_hash(phone, code.strip())):
            otp.delete()
            user = _phone_user(phone)
            tenants = Tenant.objects.select_for_update().filter(
                phone=phone, phone_claim_enabled=True, user__isnull=True
            ).select_related("owner")
            for tenant in tenants:
                _link(tenant, user, method="phone")
    if user is None:
        raise InvalidCode
    return user
