from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
import logging
import secrets
from datetime import timedelta

from django.core.files.storage import FileSystemStorage
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from django.http import FileResponse, Http404, HttpResponseRedirect
from rest_framework import generics, mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.exceptions import NotFound, Throttled, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from core.permissions import IsTenantRole
from core.tiers import tier_info
from leasing.brand import active_brand
from core.phone import try_normalize_phone
from users.models import User, UserProfile
from users.tokens import revoke_user_tokens
from users.views import AuthThrottleMixin
from leasing.models import Lease, Payment, Tenant
from leasing.views import PaymentFilter

from reminders.channels import bot_link

from . import media as media_service, receipts, services, tenant_requests
from .models import (
    LeaseMedia, LeaseRequest, TenantMeterReading, PaymentReceipt, PushSubscription, RepairRequest, TenantNotification,
)
from .serializers import (
    BulkIdsSerializer, PushSubscribeSerializer, PushUnsubscribeSerializer,
    PhoneRequestSerializer, PhoneVerifySerializer, RegisterTenantSerializer, TenantLeaseSerializer,
    TenantPaymentSerializer, AcceptSerializer, ConfirmSerializer, ReceiptSerializer, ReceiptUploadSerializer,
    RejectSerializer, TenantProfileUpdateSerializer,
    TenantPasswordSerializer, PhonePasswordSerializer, LeaseMediaSerializer, LeaseMediaUploadSerializer,
    MediaReplaceSerializer, TenantNotificationSerializer,
    RepairSerializer, RepairCreateSerializer, RepairUpdateSerializer, TenantMeterSerializer,
    TenantMeterCreateSerializer, LeaseRequestSerializer, LeaseRequestCreateSerializer,
    LeaseRequestResolveSerializer,
)
from .throttling import (
    InviteAcceptThrottle, InvitePreviewThrottle, PhoneRequestIPThrottle, PhoneVerifyThrottle, hit,
)

logger = logging.getLogger(__name__)

NOT_FOUND = "Приглашение не найдено."
GENERIC_PHONE_REPLY = {"detail": "Если номер указан верно, мы отправили на него код."}


class TenantPaymentFilter(PaymentFilter):
    """Без фильтров по FK (lease): их валидация по всем договорам раскрывала бы чужие id."""

    class Meta(PaymentFilter.Meta):
        fields = ()


class PublicView(APIView):
    """Публичный эндпоинт: без аутентификации (просроченный JWT в заголовке не мешает)."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]


class InvitePreviewView(PublicView):
    throttle_classes = [InvitePreviewThrottle]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, token):
        try:
            return Response(services.invite_preview(token))
        except services.InvalidInvite:
            raise NotFound(NOT_FOUND)


class InviteAcceptView(APIView):
    """Нужен JWT жильца (role=tenant)."""

    permission_classes = [IsTenantRole]
    throttle_classes = [InviteAcceptThrottle]

    @extend_schema(request=AcceptSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        body = AcceptSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        try:
            tenant = services.accept_invite(data["token"], request.user, data.get("full_name", ""),
                                            data.get("phone", ""))
        except services.InvalidInvite:
            raise NotFound(NOT_FOUND)
        return Response({"tenant": tenant.pk, "landlord_name": services.landlord_name(tenant.owner)})


class RegisterTenantView(PublicView):
    """Регистрация жильца и принятие приглашения одним запросом."""

    throttle_classes = [InviteAcceptThrottle]

    @extend_schema(request=RegisterTenantSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        body = RegisterTenantSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        try:
            services.find_invite(data["token"])  # сначала токен: с плохим токеном аккаунт не создаётся
            with transaction.atomic():
                user = services.create_tenant_user(
                    email=data["email"], password=data["password"],
                    first_name=data.get("first_name", ""), last_name=data.get("last_name", ""),
                )
                tenant = services.accept_invite(data["token"], user, data.get("full_name", ""),
                                                data.get("phone", ""))
        except services.InvalidInvite:
            raise NotFound(NOT_FOUND)
        return Response({"tenant": tenant.pk, "landlord_name": services.landlord_name(tenant.owner)},
                        status=status.HTTP_201_CREATED)


class PhoneRequestView(PublicView):
    throttle_classes = [PhoneRequestIPThrottle]

    @extend_schema(request=PhoneRequestSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        body = PhoneRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        phone = try_normalize_phone(body.validated_data["phone"])
        if phone is not None:
            if not hit(f"phone_number:{phone}", 3, 600):
                raise Throttled(detail="Слишком много запросов. Попробуйте позже.")
            services.send_phone_code(phone)
        # Ответ одинаков для любого номера: есть ли у него Tenant — не раскрываем.
        return Response(GENERIC_PHONE_REPLY)


class PhoneVerifyView(PublicView):
    throttle_classes = [PhoneVerifyThrottle]

    @extend_schema(request=PhoneVerifySerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        body = PhoneVerifySerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            user = services.verify_phone_code(body.validated_data["phone"], body.validated_data["code"])
        except services.InvalidCode:
            return Response({"detail": ["Неверный или просроченный код."]}, status=status.HTTP_400_BAD_REQUEST)
        refresh = RefreshToken.for_user(user)
        return Response({"access": str(refresh.access_token), "refresh": str(refresh)})


# ---------- кабинет жильца: /api/tenant/ ----------

class TenantMeView(APIView):
    permission_classes = [IsTenantRole]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(self._payload(request.user))

    @extend_schema(request=TenantProfileUpdateSerializer, responses=OpenApiTypes.OBJECT)
    def patch(self, request):
        body = TenantProfileUpdateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        user = request.user
        data = dict(body.validated_data)
        if "share_reliability" in data:  # согласие хранится в профиле, а не в самом пользователе
            profile = user.profile
            profile.share_reliability = data.pop("share_reliability")
            profile.save(update_fields=["share_reliability"])
        for name, value in data.items():
            setattr(user, name, value)
        if data:
            user.save(update_fields=list(data))
        return Response(self._payload(user))

    @staticmethod
    def _payload(user):
        records = Tenant.objects.filter(user=user).select_related("owner").order_by("id")
        return {
            "id": user.pk,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "phone": user.phone,
            "email": None if user.email.endswith("@phone.invalid") else user.email,
            "language": user.language,
            "has_password": user.has_usable_password(),
            "tours_seen": user.profile.tours_seen,
            "share_reliability": user.profile.share_reliability,
            "telegram_linked": any(t.telegram_chat_id for t in records),
            "landlords": [
                {"tenant": t.pk, "full_name": t.full_name, "landlord_name": services.landlord_name(t.owner),
                 "landlord_tier": tier_info(t.owner)["tier"]}
                for t in records
            ],
            "brands": [
                {"tenant": t.pk, "name": brand.company_name, "has_logo": bool(brand.logo)}
                for t in records
                if (brand := active_brand(t.owner, "vip")) is not None
            ],
        }


class TenantTelegramLinkView(APIView):
    """POST — одноразовый код для привязки Telegram жильца; DELETE — отвязать."""

    permission_classes = [IsTenantRole]

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        record = Tenant.objects.filter(user=request.user).order_by("id").first()
        if record is None:
            raise ValidationError({"detail": ["Нет привязанной записи жильца."]})
        record.link_code = "U" + secrets.token_hex(4).upper()  # «U» — код выдан самому жильцу (см. bot_logic.link)
        record.link_code_expires_at = timezone.now() + timedelta(hours=72)
        record.save(update_fields=["link_code", "link_code_expires_at", "updated_at"])
        return Response({"code": record.link_code, "expires_at": record.link_code_expires_at,
                         "bot_url": bot_link(record.link_code)})

    @extend_schema(request=None, responses={204: None})
    def delete(self, request):
        Tenant.objects.filter(user=request.user).update(telegram_chat_id=None, telegram_login=False, link_code=None,
                                                        link_code_expires_at=None)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TenantPasswordView(APIView):
    """Жилец задаёт пароль для входа (после регистрации по ссылке, QR или SMS)."""

    permission_classes = [IsTenantRole]

    def post(self, request):
        body = TenantPasswordSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        user = request.user
        had_password = user.has_usable_password()
        if had_password and not user.check_password(body.validated_data.get("current_password", "")):
            raise ValidationError({"current_password": ["Текущий пароль указан неверно."]})
        try:
            validate_password(body.validated_data["password"], user)
        except DjangoValidationError as exc:
            raise ValidationError({"password": list(exc.messages)})
        user.set_password(body.validated_data["password"])
        user.save(update_fields=["password"])
        if had_password:  # первая установка пароля сессию не рвёт, смена — отзывает все refresh-токены
            revoke_user_tokens(user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PhonePasswordLoginView(AuthThrottleMixin, PublicView):
    """Вход жильца по номеру телефона и паролю (аккаунт, созданный по SMS)."""

    def post(self, request):
        body = PhonePasswordSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        phone = try_normalize_phone(body.validated_data["phone"])
        user = None
        if phone:
            user = User.objects.filter(email=services.phone_email(phone), is_active=True).first()
        # check_password и для несуществующего пользователя выполняем — одинаковое время ответа
        ok = (user or User()).check_password(body.validated_data["password"]) and user is not None
        if not (ok and user.profile.role == UserProfile.Role.TENANT):
            return Response({"detail": "Неверный номер или пароль."}, status=status.HTTP_401_UNAUTHORIZED)
        refresh = RefreshToken.for_user(user)
        return Response({"refresh": str(refresh), "access": str(refresh.access_token)})


class TenantLeaseListView(generics.ListAPIView):
    permission_classes = [IsTenantRole]
    serializer_class = TenantLeaseSerializer
    ordering_fields = ("start_date", "end_date")

    def get_queryset(self):
        return Lease.objects.filter(tenant__user=self.request.user, hidden_by_tenant=False).select_related(
            "property", "owner")


class TenantLeaseHideView(APIView):
    """POST /api/tenant/leases/{id}/hide/ — убрать завершённый договор из кабинета жильца.

    Договор и платежи у арендодателя не меняются; скрыть действующий договор нельзя."""

    permission_classes = [IsTenantRole]

    @extend_schema(request=None, responses={204: None})
    def post(self, request, pk):
        lease = Lease.objects.filter(pk=pk, tenant__user=request.user, hidden_by_tenant=False).first()
        if lease is None:
            raise NotFound()
        if lease.status != Lease.Status.ENDED:
            raise ValidationError({"detail": ["Скрыть можно только завершённый договор."]})
        lease.hidden_by_tenant = True
        lease.save(update_fields=["hidden_by_tenant", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class TenantPaymentListView(generics.ListAPIView):
    permission_classes = [IsTenantRole]
    serializer_class = TenantPaymentSerializer
    filterset_class = TenantPaymentFilter
    ordering_fields = ("due_date", "amount_due")

    def get_queryset(self):
        return (
            Payment.objects.filter(lease__tenant__user=self.request.user, lease__hidden_by_tenant=False)
            .select_related("lease__property", "lease__owner").prefetch_related("receipts")
        )


class TenantReceiptCreateView(APIView):
    """POST /api/tenant/payments/{id}/receipts/ — жилец отправляет чек (multipart: file, amount?)."""

    permission_classes = [IsTenantRole]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request=ReceiptUploadSerializer, responses=ReceiptSerializer)
    def post(self, request, pk):
        body = ReceiptUploadSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            receipt = receipts.submit_receipt(
                user=request.user, payment_id=pk, file=body.validated_data["file"],
                amount=body.validated_data.get("amount"),
            )
        except Payment.DoesNotExist:
            raise NotFound()
        return Response({"id": receipt.pk, "status": receipt.status}, status=status.HTTP_201_CREATED)


class TenantPaymentReceiptPdfView(APIView):
    """GET /api/tenant/payments/{id}/receipt/ — квитанция об оплате (PDF; ?as=html — разметка)."""

    permission_classes = [IsTenantRole]

    @extend_schema(responses=OpenApiTypes.BINARY)
    def get(self, request, pk):
        from django.http import HttpResponse
        from leasing.contract import PdfUnavailable
        from leasing.receipt_doc import render_receipt_html, render_receipt_pdf

        payment = Payment.objects.filter(
            pk=pk, lease__tenant__user=request.user, lease__hidden_by_tenant=False, amount_paid__gt=0,
        ).select_related("lease__property", "lease__tenant", "owner").first()
        if payment is None:
            raise NotFound()
        if request.query_params.get("as") == "html":
            return HttpResponse(render_receipt_html(payment), content_type="text/html; charset=utf-8")
        try:
            pdf = render_receipt_pdf(payment)
        except PdfUnavailable as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="receipt-{payment.pk}.pdf"'
        return response


# ---------- Web Push (жилец и арендодатель) ----------

class PushKeyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        from django.conf import settings as dj_settings
        from .push import push_enabled
        enabled = push_enabled()
        return Response({"enabled": enabled, "public_key": dj_settings.VAPID_PUBLIC_KEY if enabled else ""})


class PushSubscribeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=PushSubscribeSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        body = PushSubscribeSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        # endpoint уникален: устройство, перешедшее к другому аккаунту, переподписывается на него
        PushSubscription.objects.update_or_create(
            endpoint=data["endpoint"],
            defaults={"user": request.user, "p256dh": data["keys"]["p256dh"], "auth": data["keys"]["auth"]},
        )
        return Response({"subscribed": True}, status=status.HTTP_201_CREATED)

    @extend_schema(request=PushUnsubscribeSerializer, responses=OpenApiTypes.OBJECT)
    def delete(self, request):
        body = PushUnsubscribeSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        PushSubscription.objects.filter(user=request.user, endpoint=body.validated_data["endpoint"]).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------- чеки у арендодателя: /api/receipts/ ----------

class ReceiptViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Только арендодатель (права по умолчанию); чужие чеки — 404."""

    serializer_class = ReceiptSerializer
    filterset_fields = ("status", "payment")
    ordering_fields = ("created_at",)

    def get_queryset(self):
        return PaymentReceipt.objects.filter(owner=self.request.user).select_related(
            "payment__lease__property", "payment__lease__tenant"
        )

    def _respond(self, receipt):
        return Response(self.get_serializer(self.get_queryset().get(pk=receipt.pk)).data)

    @action(detail=True, methods=["get"])
    def file(self, request, pk=None):
        receipt = self.get_object()
        if not isinstance(receipt.file.storage, FileSystemStorage):
            return HttpResponseRedirect(receipt.file.url)
        try:
            handle = receipt.file.open("rb")
        except FileNotFoundError:
            raise Http404
        response = FileResponse(handle, content_type=receipt.content_type)
        response["Content-Disposition"] = "inline"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        receipt = self.get_object()
        body = ConfirmSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        receipt = receipts.confirm_receipt(receipt_id=receipt.pk, owner=request.user, actor=request.user,
                                           amount=body.validated_data.get("amount"))
        return self._respond(receipt)

    @action(detail=False, methods=["post"], url_path="bulk-confirm")
    def bulk_confirm(self, request):
        """Подтвердить несколько чеков на заявленные суммы; ошибки по отдельным чекам не мешают остальным."""
        body = BulkIdsSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        ids = set(body.validated_data["ids"])
        owned = set(self.get_queryset().filter(pk__in=ids).values_list("pk", flat=True))
        confirmed, failed = [], []
        for pk in sorted(owned):
            try:
                receipts.confirm_receipt(receipt_id=pk, owner=request.user, actor=request.user)
                confirmed.append(pk)
            except ValidationError:
                failed.append(pk)
        return Response({"confirmed": confirmed, "failed": failed, "not_found": sorted(ids - owned)})

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        receipt = self.get_object()
        body = RejectSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        receipt = receipts.reject_receipt(receipt_id=receipt.pk, owner=request.user, actor=request.user,
                                          reason=body.validated_data.get("reason", ""))
        return self._respond(receipt)



def _file_response(obj):
    if not isinstance(obj.file.storage, FileSystemStorage):
        return HttpResponseRedirect(obj.file.url)
    try:
        handle = obj.file.open("rb")
    except FileNotFoundError:
        raise Http404
    response = FileResponse(handle, content_type=obj.content_type)
    response["Content-Disposition"] = "inline"
    response["X-Content-Type-Options"] = "nosniff"
    return response


# ---------- фото/видео к договору: арендодатель ----------

class LeaseMediaViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                        mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """/api/lease-media/ — только свои договоры (чужое = 404). Жилец получает уведомление."""

    serializer_class = LeaseMediaSerializer
    parser_classes = [MultiPartParser, FormParser]
    filterset_fields = ("lease", "kind")

    def get_queryset(self):
        return LeaseMedia.objects.filter(owner=self.request.user).select_related("lease__tenant")

    @extend_schema(request=LeaseMediaUploadSerializer, responses=LeaseMediaSerializer)
    def create(self, request, *args, **kwargs):
        body = LeaseMediaUploadSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        lease = (Lease.objects.filter(owner=request.user, pk=body.validated_data["lease"])
                 .select_related("tenant").first())
        if lease is None:
            raise ValidationError({"lease": ["Договор не найден."]})
        item = media_service.add_media(lease=lease, actor=request.user, file=body.validated_data["file"])
        return Response(self.get_serializer(item).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        media_service.delete_media(media=instance, actor=self.request.user)

    @extend_schema(request=MediaReplaceSerializer, responses=LeaseMediaSerializer)
    @action(detail=True, methods=["post"])
    def replace(self, request, pk=None):
        item = self.get_object()
        body = MediaReplaceSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        item = media_service.replace_media(media=item, actor=request.user, file=body.validated_data["file"])
        return Response(self.get_serializer(item).data)

    @extend_schema(responses=OpenApiTypes.BINARY)
    @action(detail=True, methods=["get"])
    def file(self, request, pk=None):
        return _file_response(self.get_object())


# ---------- фото/видео и уведомления: жилец ----------

class TenantMediaListView(generics.ListAPIView):
    permission_classes = [IsTenantRole]
    serializer_class = LeaseMediaSerializer
    filterset_fields = ("lease",)

    def get_queryset(self):
        return LeaseMedia.objects.filter(lease__tenant__user=self.request.user, lease__hidden_by_tenant=False)


class TenantMediaFileView(APIView):
    permission_classes = [IsTenantRole]

    @extend_schema(responses=OpenApiTypes.BINARY)
    def get(self, request, pk):
        item = LeaseMedia.objects.filter(pk=pk, lease__tenant__user=request.user).first()
        if item is None:
            raise NotFound()
        return _file_response(item)


class TenantBrandLogoView(APIView):
    """GET /api/tenant/brand/<tenant_id>/logo/ — логотип владельца (VIP) для шапки кабинета жильца."""

    permission_classes = [IsTenantRole]

    @extend_schema(responses=OpenApiTypes.BINARY)
    def get(self, request, pk):
        record = Tenant.objects.filter(pk=pk, user=request.user).select_related("owner").first()
        brand = active_brand(record.owner, "vip") if record else None
        if brand is None or not brand.logo:
            raise NotFound()
        try:
            handle = brand.logo.open("rb")
        except FileNotFoundError:
            raise Http404
        head = handle.read(8)
        handle.seek(0)
        response = FileResponse(handle, content_type="image/png" if head.startswith(b"\x89PNG") else "image/jpeg")
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, max-age=300"
        return response


class TenantNotificationListView(generics.ListAPIView):
    permission_classes = [IsTenantRole]
    serializer_class = TenantNotificationSerializer

    def get_queryset(self):
        return TenantNotification.objects.filter(user=self.request.user).select_related("lease__property")


class TenantNotificationReadView(APIView):
    """POST — отметить все уведомления прочитанными."""

    permission_classes = [IsTenantRole]

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        from django.utils import timezone

        TenantNotification.objects.filter(user=request.user, read_at__isnull=True).update(read_at=timezone.now())
        return Response({"detail": "ok"})


# ---------- заявки жильца: ремонт, счётчики, продление/выезд ----------

def _photo_response(obj):
    if not obj.photo:
        raise Http404
    if not isinstance(obj.photo.storage, FileSystemStorage):
        return HttpResponseRedirect(obj.photo.url)
    try:
        handle = obj.photo.open("rb")
    except FileNotFoundError:
        raise Http404
    response = FileResponse(handle, content_type=obj.photo_content_type or "application/octet-stream")
    response["Content-Disposition"] = "inline"
    response["X-Content-Type-Options"] = "nosniff"
    return response


class TenantRepairListCreateView(generics.ListCreateAPIView):
    """GET/POST /api/tenant/repairs/ — заявки на ремонт (multipart: lease, title, description?, photo?)."""

    permission_classes = [IsTenantRole]
    serializer_class = RepairSerializer
    filterset_fields = ("lease", "status")
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        return RepairRequest.objects.filter(
            lease__tenant__user=self.request.user, lease__hidden_by_tenant=False
        ).select_related("lease__property", "lease__tenant")

    @extend_schema(request=RepairCreateSerializer, responses=RepairSerializer)
    def create(self, request, *args, **kwargs):
        body = RepairCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        item = tenant_requests.create_repair(
            user=request.user, lease_id=data["lease"], title=data["title"], description=data["description"],
            photo=data.get("photo"))
        return Response(self.get_serializer(item).data, status=status.HTTP_201_CREATED)


class TenantRepairPhotoView(APIView):
    permission_classes = [IsTenantRole]

    @extend_schema(responses=OpenApiTypes.BINARY)
    def get(self, request, pk):
        item = RepairRequest.objects.filter(pk=pk, lease__tenant__user=request.user).first()
        if item is None:
            raise NotFound()
        return _photo_response(item)


class TenantMeterListCreateView(generics.ListCreateAPIView):
    """GET/POST /api/tenant/meter-readings/ — показания счётчиков (multipart: lease, kind, value, photo?)."""

    permission_classes = [IsTenantRole]
    serializer_class = TenantMeterSerializer
    filterset_fields = ("lease", "kind")
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        return TenantMeterReading.objects.filter(
            lease__tenant__user=self.request.user, lease__hidden_by_tenant=False
        ).select_related("lease__property", "lease__tenant")

    @extend_schema(request=TenantMeterCreateSerializer, responses=TenantMeterSerializer)
    def create(self, request, *args, **kwargs):
        body = TenantMeterCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        item = tenant_requests.submit_reading(
            user=request.user, lease_id=data["lease"], kind=data["kind"], value=data["value"],
            photo=data.get("photo"))
        return Response(self.get_serializer(item).data, status=status.HTTP_201_CREATED)


class TenantMeterPhotoView(APIView):
    permission_classes = [IsTenantRole]

    @extend_schema(responses=OpenApiTypes.BINARY)
    def get(self, request, pk):
        item = TenantMeterReading.objects.filter(pk=pk, lease__tenant__user=request.user).first()
        if item is None:
            raise NotFound()
        return _photo_response(item)


class TenantLeaseRequestListCreateView(generics.ListCreateAPIView):
    """GET/POST /api/tenant/lease-requests/ — просьба продлить договор или о выезде."""

    permission_classes = [IsTenantRole]
    serializer_class = LeaseRequestSerializer
    filterset_fields = ("lease", "status")

    def get_queryset(self):
        return LeaseRequest.objects.filter(
            lease__tenant__user=self.request.user, lease__hidden_by_tenant=False
        ).select_related("lease__property", "lease__tenant")

    @extend_schema(request=LeaseRequestCreateSerializer, responses=LeaseRequestSerializer)
    def create(self, request, *args, **kwargs):
        body = LeaseRequestCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        item = tenant_requests.create_lease_request(
            user=request.user, lease_id=data["lease"], kind=data["kind"], months=data.get("months"),
            move_out_date=data.get("move_out_date"), comment=data["comment"])
        return Response(self.get_serializer(item).data, status=status.HTTP_201_CREATED)


class TenantLeaseRequestCancelView(APIView):
    """POST /api/tenant/lease-requests/{id}/cancel/ — жилец отзывает просьбу, пока она не обработана."""

    permission_classes = [IsTenantRole]

    @extend_schema(request=None, responses={204: None})
    def post(self, request, pk):
        tenant_requests.cancel_lease_request(user=request.user, request_id=pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class RepairViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Арендодатель: заявки на ремонт по своим объектам (чужие — 404)."""

    serializer_class = RepairSerializer
    filterset_fields = {"status": ["exact"], "lease": ["exact"], "lease__property": ["exact"]}

    def get_queryset(self):
        return RepairRequest.objects.filter(owner=self.request.user).select_related("lease__property", "lease__tenant")

    @extend_schema(request=RepairUpdateSerializer, responses=RepairSerializer)
    @action(detail=True, methods=["post"], url_path="set-status")
    def set_status(self, request, pk=None):
        item = self.get_object()
        body = RepairUpdateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        tenant_requests.update_repair(
            owner=request.user, actor=request.user, repair_id=item.pk, status=body.validated_data["status"],
            comment=body.validated_data["landlord_comment"])
        return Response(self.get_serializer(self.get_queryset().get(pk=item.pk)).data)

    @extend_schema(responses=OpenApiTypes.BINARY)
    @action(detail=True, methods=["get"])
    def photo(self, request, pk=None):
        return _photo_response(self.get_object())


class TenantMeterViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = TenantMeterSerializer
    filterset_fields = {"lease": ["exact"], "kind": ["exact"], "lease__property": ["exact"]}

    def get_queryset(self):
        return TenantMeterReading.objects.filter(owner=self.request.user).select_related("lease__property", "lease__tenant")

    @extend_schema(responses=OpenApiTypes.BINARY)
    @action(detail=True, methods=["get"])
    def photo(self, request, pk=None):
        return _photo_response(self.get_object())


class LeaseRequestViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = LeaseRequestSerializer
    filterset_fields = ("status", "kind", "lease")

    def get_queryset(self):
        return LeaseRequest.objects.filter(owner=self.request.user).select_related("lease__property", "lease__tenant")

    def _resolve(self, request, accept):
        item = self.get_object()
        body = LeaseRequestResolveSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        tenant_requests.resolve_lease_request(
            owner=request.user, actor=request.user, request_id=item.pk, accept=accept,
            comment=body.validated_data["comment"])
        return Response(self.get_serializer(self.get_queryset().get(pk=item.pk)).data)

    @extend_schema(request=LeaseRequestResolveSerializer, responses=LeaseRequestSerializer)
    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        return self._resolve(request, True)

    @extend_schema(request=LeaseRequestResolveSerializer, responses=LeaseRequestSerializer)
    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        return self._resolve(request, False)
