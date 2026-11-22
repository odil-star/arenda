from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
import base64
from urllib.parse import urlencode

from django.conf import settings
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from core.audit import log_action
from django.shortcuts import get_object_or_404
from leasing.models import Payment


class InvoiceSerializer(serializers.Serializer):
    amount = serializers.IntegerField(min_value=1, required=False)


def payme_link(payment, amount):
    if not (settings.PAYME_MERCHANT_ID and settings.PAYME_CHECKOUT_URL):
        return None
    params = f"m={settings.PAYME_MERCHANT_ID};ac.payment_id={payment.pk};a={amount * 100}"
    return f"{settings.PAYME_CHECKOUT_URL}/{base64.b64encode(params.encode()).decode()}"


def click_link(payment, amount):
    if not (settings.CLICK_SERVICE_ID and settings.CLICK_MERCHANT_ID):
        return None
    query = urlencode({
        "service_id": settings.CLICK_SERVICE_ID, "merchant_id": settings.CLICK_MERCHANT_ID,
        "amount": amount, "transaction_param": payment.pk,
    })
    return f"https://my.click.uz/services/pay?{query}"


class InvoiceView(APIView):
    """POST /api/payments/{id}/invoice/ — ссылки на оплату в Payme/Click (по умолчанию на остаток)."""

    @extend_schema(request=InvoiceSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        payment = get_object_or_404(Payment.objects.filter(owner=request.user), pk=pk)
        body = InvoiceSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        amount = body.validated_data.get("amount", payment.remaining)
        if payment.remaining <= 0:
            raise serializers.ValidationError({"detail": ["Платёж уже оплачен."]})
        if amount > payment.remaining:
            raise serializers.ValidationError({"amount": ["Сумма превышает остаток по платежу."]})
        log_action(request.user, "payment.invoice_created", payment, actor=request.user, amount=amount)
        return Response({"payment": payment.pk, "amount": amount,
                         "payme_url": payme_link(payment, amount), "click_url": click_link(payment, amount)})
