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
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.exceptions import NotFound, Throttled, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from core.permissions import IsTenantRole
from core.phone import try_normalize_phone
from users.models import User, UserProfile
from users.views import AuthThrottleMixin
from leasing.models import Lease, Payment, Tenant
from leasing.views import PaymentFilter

from . import media as media_service, receipts, services
from .models import LeaseMedia, PaymentReceipt, TenantNotification
from .serializers import (
    PhoneRequestSerializer, PhoneVerifySerializer, RegisterTenantSerializer, TenantLeaseSerializer,
    TenantPaymentSerializer, AcceptSerializer, ConfirmSerializer, ReceiptSerializer, ReceiptUploadSerializer,
    RejectSerializer, TenantProfileUpdateSerializer,
    TenantPasswordSerializer, PhonePasswordSerializer, LeaseMediaSerializer, LeaseMediaUploadSerializer,
    MediaReplaceSerializer, TenantNotificationSerializer,
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
        fields = list(body.validated_data)
        for name, value in body.validated_data.items():
            setattr(user, name, value)
        if fields:
            user.save(update_fields=fields)
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
            "telegram_linked": any(t.telegram_chat_id for t in records),
            "landlords": [
                {"tenant": t.pk, "full_name": t.full_name, "landlord_name": services.landlord_name(t.owner)}
                for t in records
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
        record.link_code = "T" + secrets.token_hex(4).upper()
        record.link_code_expires_at = timezone.now() + timedelta(hours=72)
        record.save(update_fields=["link_code", "link_code_expires_at", "updated_at"])
        return Response({"code": record.link_code, "expires_at": record.link_code_expires_at})

    @extend_schema(request=None, responses={204: None})
    def delete(self, request):
        Tenant.objects.filter(user=request.user).update(telegram_chat_id=None, link_code=None, link_code_expires_at=None)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TenantPasswordView(APIView):
    """Жилец задаёт пароль для входа (после регистрации по ссылке, QR или SMS)."""

    permission_classes = [IsTenantRole]

    def post(self, request):
        body = TenantPasswordSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        user = request.user
        if user.has_usable_password() and not user.check_password(body.validated_data.get("current_password", "")):
            raise ValidationError({"current_password": ["Текущий пароль указан неверно."]})
        try:
            validate_password(body.validated_data["password"], user)
        except DjangoValidationError as exc:
            raise ValidationError({"password": list(exc.messages)})
        user.set_password(body.validated_data["password"])
        user.save(update_fields=["password"])
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
