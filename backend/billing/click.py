"""Click Merchant API (SHOP-API): Prepare (action=0) и Complete (action=1).

Сумма приходит в сумах. merchant_trans_id — id платежа графика.
"""
import hashlib
import hmac
from decimal import Decimal, InvalidOperation

from django.conf import settings
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from django.db import IntegrityError, transaction
from django.http import Http404
from django.utils import timezone
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.audit import log_action
from leasing import services
from leasing.models import PaymentTransaction

from .webhook_log import log_webhook

State = PaymentTransaction.State

OK, SIGN_FAILED, WRONG_AMOUNT, ACTION_NOT_FOUND, ALREADY_PAID = 0, -1, -2, -3, -4
NO_ORDER, NO_TRANSACTION, UPDATE_FAILED, BAD_REQUEST, CANCELLED = -5, -6, -7, -8, -9

NOTES = {
    OK: "Success", SIGN_FAILED: "SIGN CHECK FAILED!", WRONG_AMOUNT: "Incorrect parameter amount",
    ACTION_NOT_FOUND: "Action not found", ALREADY_PAID: "Already paid", NO_ORDER: "Order not found",
    NO_TRANSACTION: "Transaction does not exist", UPDATE_FAILED: "Failed to update user",
    BAD_REQUEST: "Error in request from click", CANCELLED: "Transaction cancelled",
}


def make_sign(params, action):
    parts = [params.get("click_trans_id", ""), params.get("service_id", ""), settings.CLICK_SECRET_KEY,
             params.get("merchant_trans_id", "")]
    if action == 1:
        parts.append(params.get("merchant_prepare_id", ""))
    parts += [params.get("amount", ""), params.get("action", ""), params.get("sign_time", "")]
    return hashlib.md5("".join(str(p) for p in parts).encode()).hexdigest()


def _sum_amount(raw):
    try:
        amount = Decimal(str(raw))
    except InvalidOperation:
        return None
    if amount <= 0 or amount != amount.to_integral_value():
        return None
    return int(amount)


class ClickWebhookView(APIView):
    authentication_classes = []
    permission_classes = []
    parser_classes = [FormParser, MultiPartParser, JSONParser]

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT, auth=[])
    @log_webhook("click")
    def post(self, request):
        data = {k: (v if isinstance(v, str) else str(v)) for k, v in request.data.items()}
        base = {
            "click_trans_id": data.get("click_trans_id"),
            "merchant_trans_id": data.get("merchant_trans_id"),
        }

        def reply(code, **extra):
            return Response({**base, **extra, "error": code, "error_note": NOTES[code]})

        if data.get("action") not in ("0", "1"):
            return reply(ACTION_NOT_FOUND)
        action = int(data["action"])
        provided = data.get("sign_string", "")
        if (not settings.CLICK_SECRET_KEY or data.get("service_id") != settings.CLICK_SERVICE_ID
                or not hmac.compare_digest(provided, make_sign(data, action))):
            return reply(SIGN_FAILED)
        try:
            payment_id = int(data.get("merchant_trans_id", ""))
        except ValueError:
            return reply(NO_ORDER)
        amount = _sum_amount(data.get("amount"))
        if amount is None or not data.get("click_trans_id"):
            return reply(BAD_REQUEST)
        return self.prepare(data, payment_id, amount, reply) if action == 0 else \
            self.complete(data, payment_id, amount, reply)

    @transaction.atomic
    def prepare(self, data, payment_id, amount, reply):
        try:
            payment = services.lock_payment(payment_id)
        except Http404:
            return reply(NO_ORDER)
        tx = PaymentTransaction.objects.filter(provider="click", external_id=data["click_trans_id"]).first()
        if tx is not None:  # повторный Prepare
            if tx.state == State.COMPLETED:
                return reply(ALREADY_PAID)
            if tx.state != State.CREATED:
                return reply(CANCELLED)
            return reply(OK, merchant_prepare_id=tx.pk)
        if payment.remaining <= 0:
            return reply(ALREADY_PAID)
        if amount > payment.remaining:
            return reply(WRONG_AMOUNT)
        try:
            with transaction.atomic():
                tx = PaymentTransaction.objects.create(
                    owner_id=payment.owner_id, payment=payment, provider="click",
                    external_id=data["click_trans_id"], amount=amount, state=State.CREATED,
                )
        except IntegrityError:
            return reply(UPDATE_FAILED)
        return reply(OK, merchant_prepare_id=tx.pk)

    @transaction.atomic
    def complete(self, data, payment_id, amount, reply):
        try:
            payment = services.lock_payment(payment_id)
        except Http404:
            return reply(NO_ORDER)
        try:
            prepare_id = int(data.get("merchant_prepare_id", ""))
        except ValueError:
            return reply(NO_TRANSACTION)
        tx = PaymentTransaction.objects.filter(
            provider="click", external_id=data["click_trans_id"], payment=payment, pk=prepare_id
        ).first()
        if tx is None:
            return reply(NO_TRANSACTION)
        if tx.state == State.COMPLETED:
            return reply(ALREADY_PAID)  # повторный вебхук — деньги второй раз не зачисляем
        if tx.state != State.CREATED:
            return reply(CANCELLED)
        if amount != tx.amount:
            return reply(WRONG_AMOUNT)
        try:
            click_error = int(data.get("error", "0"))
        except ValueError:
            click_error = -1
        if click_error < 0:
            tx.state, tx.cancelled_at = State.CANCELLED, timezone.now()
            tx.save(update_fields=["state", "cancelled_at", "updated_at"])
            return reply(CANCELLED)
        if tx.amount > payment.remaining:
            return reply(WRONG_AMOUNT)
        services.credit_payment(payment, tx.amount)
        tx.state, tx.performed_at = State.COMPLETED, timezone.now()
        tx.save(update_fields=["state", "performed_at", "updated_at"])
        log_action(payment.owner, "payment.paid", payment, actor=None, amount=tx.amount, provider="click",
                   transaction_id=tx.pk)
        return reply(OK, merchant_confirm_id=tx.pk)
