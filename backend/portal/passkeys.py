"""Вход по отпечатку / Face ID / ключу устройства (WebAuthn, «passkeys»).

Ключи — «обнаруживаемые» (resident key): на экране входа не нужно вводить ни email, ни телефон.
Пользователя определяет сохранённый credential_id. Челлендж одноразовый и живёт 5 минут в кэше.
"""
import json
import secrets

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from webauthn import (
    generate_authentication_options, generate_registration_options, options_to_json,
    verify_authentication_response, verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor, ResidentKeyRequirement,
    UserVerificationRequirement,
)

from .models import WebAuthnCredential
from .throttling import IPWindowThrottle
from .views import PublicView

CHALLENGE_TTL = 300
BAD_CREDENTIAL = {"detail": ["Не удалось подтвердить устройство. Попробуйте ещё раз или войдите по паролю."]}


class PasskeyThrottle(IPWindowThrottle):
    scope, limit, window = "passkey", 20, 600


def _take(key):
    """Достать и сразу удалить челлендж: использовать его можно только один раз."""
    value = cache.get(key)
    cache.delete(key)
    return value


class CredentialBody(serializers.Serializer):
    credential = serializers.DictField()
    name = serializers.CharField(required=False, allow_blank=True, max_length=100)


class LoginVerifyBody(serializers.Serializer):
    session = serializers.CharField(max_length=64)
    credential = serializers.DictField()


class RegisterOptionsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        user = request.user
        options = generate_registration_options(
            rp_id=settings.WEBAUTHN_RP_ID, rp_name=settings.WEBAUTHN_RP_NAME,
            user_id=str(user.pk).encode(), user_name=user.email or str(user.pk),
            user_display_name=user.get_full_name() or user.email or str(user.pk),
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            exclude_credentials=[
                PublicKeyCredentialDescriptor(id=base64url_to_bytes(c.credential_id))
                for c in user.passkeys.all()
            ],
        )
        cache.set(f"wa:reg:{user.pk}", options.challenge, CHALLENGE_TTL)
        return Response(json.loads(options_to_json(options)))


class RegisterVerifyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=CredentialBody, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        body = CredentialBody(data=request.data)
        body.is_valid(raise_exception=True)
        challenge = _take(f"wa:reg:{request.user.pk}")
        if challenge is None:
            return Response(BAD_CREDENTIAL, status=status.HTTP_400_BAD_REQUEST)
        try:
            verified = verify_registration_response(
                credential=body.validated_data["credential"], expected_challenge=challenge,
                expected_rp_id=settings.WEBAUTHN_RP_ID, expected_origin=settings.WEBAUTHN_ORIGINS,
                require_user_verification=True,
            )
        except (InvalidRegistrationResponse, ValueError, KeyError, TypeError):
            return Response(BAD_CREDENTIAL, status=status.HTTP_400_BAD_REQUEST)
        credential_id = bytes_to_base64url(verified.credential_id)
        if WebAuthnCredential.objects.filter(credential_id=credential_id).exists():
            return Response(BAD_CREDENTIAL, status=status.HTTP_400_BAD_REQUEST)
        item = WebAuthnCredential.objects.create(
            user=request.user, credential_id=credential_id, public_key=verified.credential_public_key,
            sign_count=verified.sign_count, name=body.validated_data.get("name", "").strip()[:100],
        )
        return Response({"id": item.pk}, status=status.HTTP_201_CREATED)


class LoginOptionsView(PublicView):
    throttle_classes = [PasskeyThrottle]

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        options = generate_authentication_options(
            rp_id=settings.WEBAUTHN_RP_ID, user_verification=UserVerificationRequirement.REQUIRED,
        )
        session = secrets.token_urlsafe(24)
        cache.set(f"wa:auth:{session}", options.challenge, CHALLENGE_TTL)
        return Response({"session": session, "options": json.loads(options_to_json(options))})


class LoginVerifyView(PublicView):
    throttle_classes = [PasskeyThrottle]

    @extend_schema(request=LoginVerifyBody, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        body = LoginVerifyBody(data=request.data)
        body.is_valid(raise_exception=True)
        challenge = _take(f"wa:auth:{body.validated_data['session']}")
        credential = body.validated_data["credential"]
        stored = None
        if challenge is not None:
            stored = WebAuthnCredential.objects.select_related("user").filter(
                credential_id=str(credential.get("id", ""))).first()
        if stored is None or not stored.user.is_active:
            return Response(BAD_CREDENTIAL, status=status.HTTP_400_BAD_REQUEST)
        try:
            verified = verify_authentication_response(
                credential=credential, expected_challenge=challenge,
                expected_rp_id=settings.WEBAUTHN_RP_ID, expected_origin=settings.WEBAUTHN_ORIGINS,
                credential_public_key=bytes(stored.public_key), credential_current_sign_count=stored.sign_count,
                require_user_verification=True,
            )
        except (InvalidAuthenticationResponse, ValueError, KeyError, TypeError):
            return Response(BAD_CREDENTIAL, status=status.HTTP_400_BAD_REQUEST)
        stored.sign_count = verified.new_sign_count
        stored.last_used_at = timezone.now()
        stored.save(update_fields=["sign_count", "last_used_at"])
        refresh = RefreshToken.for_user(stored.user)
        return Response({"access": str(refresh.access_token), "refresh": str(refresh)})


class PasskeyListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response([
            {"id": c.pk, "name": c.name, "created_at": c.created_at, "last_used_at": c.last_used_at}
            for c in request.user.passkeys.all()
        ])


class PasskeyDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        deleted, _ = request.user.passkeys.filter(pk=pk).delete()
        if not deleted:
            raise NotFound()
        return Response(status=status.HTTP_204_NO_CONTENT)
