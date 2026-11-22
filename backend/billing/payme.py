"""Payme Merchant API (JSON-RPC). Документация: developer.help.paycom.uz

Сумма в запросах — в тийинах (1 сум = 100 тийин), в нашей БД — в сумах.
Аккаунт покупателя: {"payment_id": <id платежа графика>}.
"""
import base64
import hmac
from datetime import timedelta

from django.conf import settings
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from django.db import transaction
from django.utils import timezone
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.audit import log_action
from leasing import services
from leasing.models import Payment, PaymentTransaction

from .webhook_log import log_webhook

State = PaymentTransaction.State
TRANSACTION_TIMEOUT = timedelta(hours=12)

ERRORS = {
    -32504: {"ru": "Недостаточно привилегий для выполнения метода.", "uz": "Metodni bajarish uchun huquq yetarli emas.", "en": "Insufficient privileges."},
    -32600: {"ru": "Неверный запрос.", "uz": "Noto'g'ri so'rov.", "en": "Invalid request."},
    -32601: {"ru": "Метод не найден.", "uz": "Metod topilmadi.", "en": "Method not found."},
    -31001: {"ru": "Неверная сумма.", "uz": "Noto'g'ri summa.", "en": "Wrong amount."},
    -31003: {"ru": "Транзакция не найдена.", "uz": "Tranzaksiya topilmadi.", "en": "Transaction not found."},
    -31007: {"ru": "Заказ выполнен. Невозможно отменить транзакцию.", "uz": "Buyurtma bajarilgan.", "en": "Cannot cancel."},
    -31008: {"ru": "Невозможно выполнить операцию.", "uz": "Amalni bajarib bo'lmaydi.", "en": "Unable to perform operation."},
    -31050: {"ru": "Платёж не найден.", "uz": "To'lov topilmadi.", "en": "Payment not found."},
}


class PaymeError(Exception):
    def __init__(self, code, data=None):
        self.code, self.data = code, data


def _ms(dt):
    return int(dt.timestamp() * 1000) if dt else 0


def _authorized(request):
    header = request.headers.get("Authorization", "")
    if not settings.PAYME_KEY or not header.startswith("Basic "):
        return False
    try:
        login, _, password = base64.b64decode(header[6:]).decode().partition(":")
    except Exception:  # noqa: BLE001
        return False
    return hmac.compare_digest(login, "Paycom") and hmac.compare_digest(password, settings.PAYME_KEY)


def _account_payment_id(params):
    account = params.get("account") or {}
    try:
        return int(account.get("payment_id"))
    except (TypeError, ValueError):
        raise PaymeError(-31050, "payment_id")


def _amount_in_sums(params):
    amount = params.get("amount")
    if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0 or amount % 100:
        raise PaymeError(-31001)
    return amount // 100


def _validate(payment, amount_sums):
    if amount_sums > payment.remaining:
        raise PaymeError(-31001)


def _tx_dict(tx):
    return {
        "create_time": _ms(tx.created_at),
        "perform_time": _ms(tx.performed_at),
        "cancel_time": _ms(tx.cancelled_at),
        "transaction": str(tx.pk),
        "state": int(tx.state),
        "reason": tx.reason,
    }


def _get_tx(params):
    tx = PaymentTransaction.objects.filter(provider="payme", external_id=str(params.get("id", ""))).first()
    if tx is None:
        raise PaymeError(-31003)
    return tx


def _cancel_created(tx, reason):
    tx.state, tx.reason, tx.cancelled_at = State.CANCELLED, reason, timezone.now()
    tx.save(update_fields=["state", "reason", "cancelled_at", "updated_at"])


def check_perform_transaction(params):
    payment = Payment.objects.filter(pk=_account_payment_id(params)).first()
    if payment is None:
        raise PaymeError(-31050, "payment_id")
    _validate(payment, _amount_in_sums(params))
    return {"allow": True}


def create_transaction(params):
    payment_id = _account_payment_id(params)
    late = False
    with transaction.atomic():
        try:
            payment = services.lock_payment(payment_id)
        except Exception:  # noqa: BLE001 — Http404
            raise PaymeError(-31050, "payment_id")
        existing = PaymentTransaction.objects.filter(
            provider="payme", external_id=str(params.get("id", ""))
        ).first()
        if existing is not None:
            if existing.state != State.CREATED:
                raise PaymeError(-31008)
            if timezone.now() - existing.created_at > TRANSACTION_TIMEOUT:
                _cancel_created(existing, 4)
                late = True
            else:
                return _tx_dict(existing)
        else:
            amount = _amount_in_sums(params)
            _validate(payment, amount)
            # По документации у одного заказа может быть одна незавершённая транзакция.
            if PaymentTransaction.objects.filter(payment=payment, provider="payme", state=State.CREATED).exists():
                raise PaymeError(-31008)
            tx = PaymentTransaction.objects.create(
                owner_id=payment.owner_id, payment=payment, provider="payme", external_id=str(params["id"]),
                amount=amount, state=State.CREATED, provider_time_ms=params.get("time"),
            )
            return _tx_dict(tx)
    if late:  # отмена по таймауту должна сохраниться, поэтому ошибка — уже после коммита
        raise PaymeError(-31008)


def perform_transaction(params):
    tx = _get_tx(params)
    expired = False
    with transaction.atomic():
        payment = services.lock_payment(tx.payment_id)
        tx.refresh_from_db()  # состояние могло измениться, пока ждали блокировку
        if tx.state == State.COMPLETED:
            return _tx_dict(tx)  # повторный вызов — идемпотентно
        if tx.state != State.CREATED:
            raise PaymeError(-31008)
        if timezone.now() - tx.created_at > TRANSACTION_TIMEOUT or tx.amount > payment.remaining:
            _cancel_created(tx, 4)
            expired = True
        else:
            services.credit_payment(payment, tx.amount)
            tx.state, tx.performed_at = State.COMPLETED, timezone.now()
            tx.save(update_fields=["state", "performed_at", "updated_at"])
            log_action(payment.owner, "payment.paid", payment, actor=None, amount=tx.amount, provider="payme",
                       transaction_id=tx.pk)
            return _tx_dict(tx)
    if expired:
        raise PaymeError(-31008)


@transaction.atomic
def cancel_transaction(params):
    tx = _get_tx(params)
    payment = services.lock_payment(tx.payment_id)
    tx.refresh_from_db()
    reason = params.get("reason")
    if tx.state in (State.CANCELLED, State.REFUNDED):
        return _tx_dict(tx)
    if tx.state == State.CREATED:
        _cancel_created(tx, reason)
    else:
        if payment.amount_paid < tx.amount:
            raise PaymeError(-31007)
        services.revert_payment(payment, tx.amount)
        tx.state, tx.reason, tx.cancelled_at = State.REFUNDED, reason, timezone.now()
        tx.save(update_fields=["state", "reason", "cancelled_at", "updated_at"])
        log_action(payment.owner, "payment.refunded", payment, actor=None, amount=tx.amount, provider="payme",
                   transaction_id=tx.pk, reason=reason)
    return _tx_dict(tx)


def check_transaction(params):
    return _tx_dict(_get_tx(params))


def get_statement(params):
    start, end = params.get("from"), params.get("to")
    if not isinstance(start, int) or not isinstance(end, int):
        raise PaymeError(-32600)
    txs = PaymentTransaction.objects.filter(
        provider="payme", provider_time_ms__gte=start, provider_time_ms__lte=end
    ).order_by("provider_time_ms")
    return {"transactions": [
        {"id": tx.external_id, "time": tx.provider_time_ms, "amount": tx.amount * 100,
         "account": {"payment_id": str(tx.payment_id)}, **_tx_dict(tx)}
        for tx in txs
    ]}


METHODS = {
    "CheckPerformTransaction": check_perform_transaction,
    "CreateTransaction": create_transaction,
    "PerformTransaction": perform_transaction,
    "CancelTransaction": cancel_transaction,
    "CheckTransaction": check_transaction,
    "GetStatement": get_statement,
}


class PaymeWebhookView(APIView):
    authentication_classes = []
    permission_classes = []
    parser_classes = [JSONParser]

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT, auth=[])
    @log_webhook("payme")
    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        request_id = body.get("id")

        def error(code, data=None):
            payload = {"code": code, "message": ERRORS[code]}
            if data:
                payload["data"] = data
            return Response({"error": payload, "id": request_id})  # Payme ждёт HTTP 200

        if not _authorized(request):
            return error(-32504)
        method = METHODS.get(body.get("method"))
        if method is None:
            return error(-32601)
        params = body.get("params")
        if not isinstance(params, dict):
            return error(-32600)
        try:
            return Response({"result": method(params), "id": request_id})
        except PaymeError as exc:
            return error(exc.code, exc.data)
