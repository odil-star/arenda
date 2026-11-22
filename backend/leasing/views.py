from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
import secrets
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, ExpressionWrapper, F, IntegerField, Q, Sum
from django.db.models.deletion import ProtectedError
from django_filters import rest_framework as filters
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from django.http import HttpResponse
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils import timezone

from core.audit import log_action
from core.mixins import OwnedQuerysetMixin
from core.plans import ensure_can_add_property

from portal import services as portal_services

from . import services
from .contract import PdfUnavailable, render_contract_html, render_contract_pdf
from .models import Lease, Payment, Property, Tenant
from .serializers import (
    ExtendLeaseSerializer, LeaseSerializer, PaymentSerializer, PaySerializer, PropertySerializer,
    TenantSerializer,
)


class OwnedModelViewSet(OwnedQuerysetMixin, viewsets.ModelViewSet):
    """CRUD с привязкой к владельцу из сессии и журналом удалений."""

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_destroy(self, instance):
        try:
            with transaction.atomic():
                log_action(self.request.user, f"{instance._meta.model_name}.deleted", instance,
                           actor=self.request.user, repr=str(instance))
                instance.delete()
        except ProtectedError:
            raise ValidationError({"detail": ["Нельзя удалить: есть связанные записи (договоры или оплаты)."]})


class PropertyViewSet(OwnedModelViewSet):
    queryset = Property.objects.all()
    serializer_class = PropertySerializer
    filterset_fields = ("kind", "is_under_repair")
    search_fields = ("name", "address")
    ordering_fields = ("name", "created_at")

    def perform_create(self, serializer):
        # Лимит объектов по тарифу; блокировка строки тарифа не даёт двум параллельным запросам превысить лимит.
        with transaction.atomic():
            ensure_can_add_property(self.request.user)
            super().perform_create(serializer)

    @action(detail=True, methods=["post"])
    def invite(self, request, pk=None):
        """Приглашение от объекта: жилец действующего договора либо новый жилец, который введёт данные сам."""
        prop = self.get_object()
        with transaction.atomic():
            tenant = portal_services.tenant_for_property_invite(prop, request.user)
            invite, token = portal_services.create_invite(
                tenant_id=tenant.pk, owner=request.user, actor=request.user, property=prop)
        return Response({"url": portal_services.invite_url(token), "expires_at": invite.expires_at,
                         "tenant": tenant.pk}, status=201)

    @action(detail=True, methods=["get"], url_path="invite/qr")
    def invite_qr(self, request, pk=None):
        """SVG-QR той же ссылки: ?token=… из ответа invite."""
        prop = self.get_object()
        token = request.query_params.get("token", "")
        try:
            invite = portal_services.find_invite(token)
        except portal_services.InvalidInvite:
            raise NotFound()
        if invite.property_id != prop.pk:
            raise NotFound()
        response = HttpResponse(portal_services.invite_qr_svg(token), content_type="image/svg+xml")
        response["Cache-Control"] = "no-store"
        return response


def _active_tenant(prop):
    """Жилец действующего договора объекта; иначе понятная ошибка."""
    lease = prop.leases.filter(status=Lease.Status.ACTIVE).select_related("tenant").first()
    if lease is None:
        raise ValidationError({"detail": ["На объекте нет действующего договора: сначала создайте договор с жильцом."]})
    return lease.tenant


class TenantViewSet(OwnedModelViewSet):
    queryset = Tenant.objects.prefetch_related("invites")
    serializer_class = TenantSerializer
    search_fields = ("full_name", "phone")
    ordering_fields = ("full_name", "created_at")

    @action(detail=True, methods=["post"], url_path="link-code")
    def link_code(self, request, pk=None):
        """Одноразовый код: арендатор отправляет его боту и привязывает свой Telegram."""
        tenant = self.get_object()
        tenant.link_code = "T" + secrets.token_hex(4).upper()
        tenant.link_code_expires_at = timezone.now() + timedelta(hours=72)
        tenant.save(update_fields=["link_code", "link_code_expires_at", "updated_at"])
        return Response({"code": tenant.link_code, "expires_at": tenant.link_code_expires_at})

    @action(detail=True, methods=["post"])
    def invite(self, request, pk=None):
        """Новое приглашение (прежние активные отзываются). Токен виден только в этом ответе."""
        tenant = self.get_object()
        invite, token = portal_services.create_invite(tenant_id=tenant.pk, owner=request.user, actor=request.user)
        return Response({"url": portal_services.invite_url(token), "expires_at": invite.expires_at},
                        status=201)

    @action(detail=True, methods=["get"], url_path="invite/qr")
    def invite_qr(self, request, pk=None):
        """QR (SVG) со ссылкой-приглашением. Токен берётся из ответа invite: ?token=…"""
        tenant = self.get_object()
        token = request.query_params.get("token", "")
        try:
            invite = portal_services.find_invite(token)
        except portal_services.InvalidInvite:
            raise NotFound()
        if invite.tenant_id != tenant.pk:
            raise NotFound()
        response = HttpResponse(portal_services.invite_qr_svg(token), content_type="image/svg+xml")
        response["Cache-Control"] = "no-store"
        return response

    @action(detail=True, methods=["post"])
    def unlink(self, request, pk=None):
        """Отвязать аккаунт жильца, отозвать приглашения и выключить привязку по телефону."""
        tenant = self.get_object()
        tenant = portal_services.unlink_tenant(tenant_id=tenant.pk, owner=request.user, actor=request.user)
        return Response(self.get_serializer(Tenant.objects.prefetch_related("invites").get(pk=tenant.pk)).data)


class LeaseViewSet(OwnedModelViewSet):
    queryset = Lease.objects.select_related("property", "tenant")
    serializer_class = LeaseSerializer
    filterset_fields = ("status", "property", "tenant")
    ordering_fields = ("start_date", "end_date", "created_at")

    def perform_create(self, serializer):
        data = dict(serializer.validated_data)
        serializer.instance = services.create_lease(
            owner=self.request.user, actor=self.request.user, **data
        )

    @action(detail=True, methods=["post"])
    def end(self, request, pk=None):
        lease = self.get_object()
        lease = services.end_lease(lease_id=lease.pk, owner=request.user, actor=request.user)
        return Response(self.get_serializer(lease).data)

    @action(detail=True, methods=["get"])
    def contract(self, request, pk=None):
        """PDF-договор из шаблона; ?as=html отдаёт HTML (для предпросмотра)."""
        lease = self.get_object()
        if request.query_params.get("as") == "html":
            return HttpResponse(render_contract_html(lease), content_type="text/html; charset=utf-8")
        try:
            pdf = render_contract_pdf(lease)
        except PdfUnavailable as exc:
            return Response({"detail": [str(exc)]}, status=503)
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="contract-{lease.pk}.pdf"'
        return response

    @action(detail=True, methods=["post"])
    def extend(self, request, pk=None):
        lease = self.get_object()
        body = ExtendLeaseSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        lease, created = services.extend_lease(
            lease_id=lease.pk, owner=request.user, actor=request.user,
            new_end_date=body.validated_data["end_date"],
        )
        data = self.get_serializer(lease).data
        data["payments_created"] = created
        return Response(data)


class PaymentFilter(filters.FilterSet):
    status = filters.ChoiceFilter(choices=Payment.Status.choices, method="filter_status")
    property = filters.NumberFilter(field_name="lease__property_id")
    due_from = filters.DateFilter(field_name="due_date", lookup_expr="gte")
    due_to = filters.DateFilter(field_name="due_date", lookup_expr="lte")

    class Meta:
        model = Payment
        fields = ("lease",)

    def filter_status(self, queryset, name, value):
        today = timezone.localdate()
        conditions = {
            "paid": Q(amount_paid__gte=F("amount_due")),
            "partial": Q(amount_paid__gt=0, amount_paid__lt=F("amount_due")),
            "overdue": Q(amount_paid=0, due_date__lt=today),
            "pending": Q(amount_paid=0, due_date__gte=today),
        }
        return queryset.filter(conditions[value])


class PaymentViewSet(OwnedQuerysetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                     viewsets.GenericViewSet):
    queryset = Payment.objects.select_related("lease__property", "lease__tenant")
    serializer_class = PaymentSerializer
    filterset_class = PaymentFilter
    ordering_fields = ("due_date", "amount_due")

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        payment = self.get_object()  # 404 для чужого платежа
        body = PaySerializer(data=request.data)
        body.is_valid(raise_exception=True)
        key = request.headers.get("Idempotency-Key") or body.validated_data.get("idempotency_key")
        # Ключ принадлежит владельцу: чужие ключи не пересекаются с нашими.
        external_id = f"{request.user.pk}:{key}" if key else services.new_manual_key()
        try:
            services.apply_payment(
                payment_id=payment.pk, amount=body.validated_data["amount"], provider="manual",
                external_id=external_id, owner=request.user, actor=request.user,
            )
        except services.PaymentError as exc:
            raise ValidationError({"amount" if exc.code == "amount" else "idempotency_key": [exc.message]})
        payment = self.get_queryset().get(pk=payment.pk)
        return Response(self.get_serializer(payment).data)


class DashboardView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        owner = request.user
        today = timezone.localdate()
        month_start = today.replace(day=1)
        next_month = (month_start + timedelta(days=32)).replace(day=1)

        props = Property.objects.filter(owner=owner)
        total = props.count()
        under_repair = props.filter(is_under_repair=True).count()
        occupied = Lease.objects.filter(owner=owner, status=Lease.Status.ACTIVE).count()
        vacant = props.filter(is_under_repair=False).exclude(leases__status=Lease.Status.ACTIVE).count()

        debt = ExpressionWrapper(F("amount_due") - F("amount_paid"), output_field=IntegerField())
        payments = Payment.objects.filter(owner=owner)
        month = payments.filter(due_date__gte=month_start, due_date__lt=next_month).aggregate(
            expected=Sum("amount_due"), received=Sum("amount_paid")
        )
        unpaid = payments.filter(amount_paid__lt=F("amount_due"))
        overdue = unpaid.filter(due_date__lt=today).aggregate(count=Count("id"), amount=Sum(debt))
        upcoming = unpaid.filter(due_date__gte=today, due_date__lte=today + timedelta(days=7)).aggregate(
            count=Count("id"), amount=Sum(debt)
        )
        expiring = Lease.objects.filter(
            owner=owner, status=Lease.Status.ACTIVE,
            end_date__gte=today, end_date__lte=today + timedelta(days=30),
        ).count()

        return Response({
            "properties": {"total": total, "occupied": occupied, "vacant": vacant,
                           "under_repair": under_repair},
            "month": {"expected": month["expected"] or 0, "received": month["received"] or 0},
            "overdue": {"count": overdue["count"], "amount": overdue["amount"] or 0},
            "upcoming_7_days": {"count": upcoming["count"], "amount": upcoming["amount"] or 0},
            "leases_expiring_30_days": expiring,
        })
