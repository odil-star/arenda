"""Prime: свой бланк договора — название, реквизиты и логотип в шапке PDF-договора."""
import base64
import logging

from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.audit import log_action
from core.tiers import has_tier

from .models import ContractBrand
from .uploads import validate_upload

logger = logging.getLogger(__name__)
MAX_LOGO_BYTES = 1024 * 1024  # логотип в шапке — не больше 1 МБ


def active_brand(owner, minimum="prime"):
    """Бланк владельца, если он есть и тариф не ниже `minimum`; иначе None (всё остаётся стандартным)."""
    brand = ContractBrand.objects.filter(user=owner).first()
    if brand is None or not has_tier(owner, minimum):
        return None
    if not (brand.company_name or brand.requisites.strip() or brand.logo):
        return None
    return brand


def logo_data_uri(brand):
    """Логотип как data:-ссылка: WeasyPrint не ходит за файлом ни в хранилище, ни в сеть."""
    if not brand.logo:
        return ""
    try:
        with brand.logo.open("rb") as fh:
            raw = fh.read()
    except OSError:
        logger.warning("Логотип бланка %s недоступен", brand.pk)
        return ""
    mime = "image/png" if raw.startswith(b"\x89PNG") else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


class BrandSerializer(serializers.ModelSerializer):
    has_logo = serializers.SerializerMethodField()

    class Meta:
        model = ContractBrand
        fields = ("company_name", "requisites", "has_logo")

    def get_has_logo(self, obj) -> bool:
        return bool(obj.logo)


class ContractBrandView(APIView):
    """GET/PUT/DELETE /api/contract-brand/ — бланк договора. Менять можно только на Prime и выше."""

    parser_classes = [MultiPartParser, FormParser]

    def _require_prime(self, request):
        if not has_tier(request.user, "prime"):
            raise PermissionDenied("Свой бланк договора доступен на тарифе Prime и выше.")

    def get(self, request):
        brand = ContractBrand.objects.filter(user=request.user).first()
        data = BrandSerializer(brand).data if brand else {"company_name": "", "requisites": "", "has_logo": False}
        return Response({**data, "available": has_tier(request.user, "prime")})

    def put(self, request):
        self._require_prime(request)
        brand, _ = ContractBrand.objects.get_or_create(user=request.user)
        serializer = BrandSerializer(brand, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        logo = request.FILES.get("logo")
        if logo is not None:
            validate_upload(logo, "photo")
            if logo.size > MAX_LOGO_BYTES:
                raise ValidationError({"logo": ["Логотип слишком большой (максимум 1 МБ)."]})
            if brand.logo:
                brand.logo.delete(save=False)
            brand.logo.save(logo.name, logo, save=True)
        elif request.data.get("remove_logo") in ("1", "true", "True", True) and brand.logo:
            brand.logo.delete(save=True)
        log_action(request.user, "contract_brand_update", brand, actor=request.user)
        return self.get(request)

    def delete(self, request):
        """Сбросить бланк целиком (разрешено и после окончания тарифа)."""
        brand = ContractBrand.objects.filter(user=request.user).first()
        if brand is not None:
            if brand.logo:
                brand.logo.delete(save=False)
            brand.delete()
        return Response(status=204)
