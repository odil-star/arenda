"""Публичный поиск квартир.

Гость видит только объекты, которые владелец сам разрешил показывать (is_listed),
не на ремонте и без действующего договора. Связь — напрямую с владельцем: звонок или сообщение.
"""
import secrets
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db.models import Case, IntegerField, Count, Exists, Min, OuterRef, Prefetch, Q, Value, When
from django.http import FileResponse, Http404, HttpResponseRedirect
from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.tiers import owner_ids_with_tier
from portal.throttling import IPWindowThrottle

from django.utils import timezone

from .models import Document, Lease, Property, SavedSearch


SIMILAR_LIMIT = 10
BOOST_LIMIT = 3  # Prime: сколько объявлений владельца закрепляется вверху ленты
VIP_BOOST_LIMIT = None  # VIP: без ограничения — все свободные объявления всегда наверху, выше Prime


class ListingBrowseThrottle(IPWindowThrottle):
    scope, limit, window = "listing_browse", 240, 60


class SavedSearchThrottle(IPWindowThrottle):
    scope, limit, window = "saved_search", 10, 3600


# Параметры, которые можно сохранить в поиске (остальное отбрасываем).
FILTER_KEYS = ("search", "kind", "rooms", "owner", "price_min", "price_max", "area_min", "area_max",
               "renovation", "furniture", "amenities", "new_days", "has_photo")
MAX_NEW_DAYS = 365


def _digits(value):
    value = str(value or "").strip()
    return int(value) if value.isdigit() and len(value) < 15 else None


def _decimal(value):
    try:
        number = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() and number >= 0 else None


def clean_filters(raw):
    """Оставляет только известные фильтры с безопасными значениями (для сохранения поиска)."""
    out = {}
    for key in FILTER_KEYS:
        value = str(raw.get(key, "")).strip()
        if not value:
            continue
        if key == "search":
            out[key] = value[:100]
        elif key == "kind" and value in Property.Kind.values:
            out[key] = value
        elif key == "renovation" and value in Property.Renovation.values:
            out[key] = value
        elif key == "furniture" and value in Property.Furniture.values:
            out[key] = value
        elif key == "amenities":
            items = [a for a in dict.fromkeys(value.split(",")) if a in Property.AMENITIES]
            if items:
                out[key] = ",".join(items)
        elif key in ("area_min", "area_max"):
            number = _decimal(value)
            if number is not None:
                out[key] = str(number)
        elif key == "has_photo":
            if value in ("1", "true"):
                out[key] = "1"
        elif _digits(value) is not None:
            out[key] = str(min(_digits(value), MAX_NEW_DAYS if key == "new_days" else 10**13))
    return out


def apply_filters(qs, raw):
    """Единая фильтрация выдачи: и для списка, и для сохранённых поисков."""
    f = clean_filters(raw)
    for term in f.get("search", "").split():
        qs = qs.filter(Q(name__icontains=term) | Q(address__icontains=term) | Q(listing_description__icontains=term))
    for key in ("kind", "rooms", "owner", "renovation", "furniture"):
        if key in f:
            qs = qs.filter(**{key: f[key]})
    for key, lookup in (("price_min", "listing_price__gte"), ("price_max", "listing_price__lte"),
                        ("area_min", "area_m2__gte"), ("area_max", "area_m2__lte")):
        if key in f:
            qs = qs.filter(**{lookup: f[key]})
    wanted = {a for a in f.get("amenities", "").split(",") if a}
    if wanted:  # JSON-contains не работает на SQLite (dev), поэтому отбираем id в Python: объектов немного
        ids = [pk for pk, have in qs.order_by().values_list("pk", "amenities") if wanted <= set(have or [])]
        qs = qs.filter(pk__in=ids)
    if "new_days" in f:
        qs = qs.filter(updated_at__gte=timezone.now() - timedelta(days=int(f["new_days"])))
    if "has_photo" in f:
        qs = qs.filter(Exists(Document.objects.filter(property=OuterRef("pk"), kind=Document.Kind.PHOTO)))
    return qs


def available_properties():
    active = Lease.objects.filter(property=OuterRef("pk"), status=Lease.Status.ACTIVE)
    return (
        Property.objects.filter(is_listed=True, is_under_repair=False, listing_price__gt=0)
        .exclude(Exists(active))
        .select_related("owner")
        .prefetch_related(Prefetch(
            "documents", queryset=Document.objects.filter(kind=Document.Kind.PHOTO).order_by("created_at", "id"),
            to_attr="photos",
        ))
    )


def _top_ids(owners, limit):
    """Самые свежие свободные объявления каждого из владельцев, не больше `limit` на владельца."""
    if not owners:
        return []
    if limit is None:
        return list(available_properties().order_by().filter(owner__in=owners).values_list("pk", flat=True))
    per_owner, ids = {}, []
    rows = available_properties().order_by().filter(owner__in=owners).order_by("-updated_at", "-id")
    for pk, owner_id in rows.values_list("pk", "owner_id"):
        if per_owner.get(owner_id, 0) < limit:
            per_owner[owner_id] = per_owner.get(owner_id, 0) + 1
            ids.append(pk)
    return ids


def boost_ids():
    """(VIP, Prime): закреплённые объявления. VIP — выше Prime и мест больше; владелец попадает в один из списков."""
    vip = owner_ids_with_tier("vip")
    prime = owner_ids_with_tier("prime") - vip
    return _top_ids(vip, VIP_BOOST_LIMIT), _top_ids(prime, BOOST_LIMIT)


class ListingSerializer(serializers.ModelSerializer):
    title = serializers.CharField(source="name")
    price = serializers.IntegerField(source="listing_price")
    description = serializers.CharField(source="listing_description")
    phone = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    owner_since = serializers.SerializerMethodField()
    owner_listings = serializers.SerializerMethodField()
    photos = serializers.SerializerMethodField()
    boosted = serializers.SerializerMethodField()
    boost_tier = serializers.SerializerMethodField()

    class Meta:
        model = Property
        fields = ("id", "title", "boosted", "boost_tier", "address", "kind", "area_m2", "rooms", "price", "description", "phone", "has_telegram",
                  "floor", "floors_total", "renovation", "furniture", "amenities", "latitude", "longitude",
                  "owner", "owner_name", "owner_since",
                  "owner_listings", "photos", "created_at", "updated_at")

    def get_boosted(self, obj) -> bool:
        return bool(getattr(obj, "boost_rank", 0))

    def get_boost_tier(self, obj) -> str | None:
        return {2: "vip", 1: "prime"}.get(getattr(obj, "boost_rank", 0))

    def get_phone(self, obj):
        """Номер для связи: указанный в объявлении, иначе номер аккаунта владельца."""
        return obj.contact_phone or obj.owner.phone

    def get_owner_name(self, obj):
        """Имя владельца для карточки; e-mail и прочие данные аккаунта не отдаём."""
        return obj.owner.get_full_name().strip()

    def get_owner_since(self, obj):
        return obj.owner.date_joined.date().isoformat()

    def get_owner_listings(self, obj):
        """Сколько свободных объявлений у владельца (считаем один раз на запрос)."""
        counts = self.context.get("_owner_counts")
        if counts is None:
            counts = dict(available_properties().order_by().values_list("owner").annotate(n=Count("pk")))
            self.context["_owner_counts"] = counts
        return counts.get(obj.owner_id, 1)

    def get_photos(self, obj):
        return [f"/api/listings/{obj.pk}/photos/{doc.pk}/" for doc in obj.photos]


class ListingViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/listings/ — свободные объекты; фильтры — см. FILTER_KEYS."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ListingBrowseThrottle]
    serializer_class = ListingSerializer
    ordering_fields = ("listing_price", "updated_at", "area_m2")
    ordering = ("-updated_at", "-id")

    def get_queryset(self):
        qs = apply_filters(available_properties(), self.request.query_params)
        vip, prime = boost_ids()
        return qs.annotate(boost_rank=Case(
            When(pk__in=vip, then=Value(2)), When(pk__in=prime, then=Value(1)),
            default=Value(0), output_field=IntegerField(),
        ))

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        if "ordering" not in self.request.query_params:  # закреплённые — вверху ленты, дальше обычный порядок
            return queryset.order_by("-boost_rank", "-updated_at", "-id")
        # гость выбрал сортировку (в интерфейсе она есть всегда): VIP, затем Prime всё равно наверху, внутри групп — его порядок
        return queryset.order_by("-boost_rank", *queryset.query.order_by)

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Цифры для шапки страницы: сколько объектов, владельцев, от какой цены и сколько новых за неделю."""
        qs = available_properties().order_by()
        week = timezone.now() - timedelta(days=7)
        agg = qs.aggregate(count=Count("pk"), owners=Count("owner", distinct=True), min_price=Min("listing_price"),
                           new_week=Count("pk", filter=Q(updated_at__gte=week)))
        return Response(agg)

    @action(detail=False, methods=["post"], url_path="saved-searches", throttle_classes=[SavedSearchThrottle])
    def saved_searches(self, request):
        """Сохранить поиск: возвращает ссылку на Telegram-бота, где гость подтверждает получение уведомлений."""
        filters = clean_filters(request.data.get("filters") or {}) if isinstance(request.data.get("filters", {}), dict) else {}
        language = "uz" if request.data.get("language") == "uz" else "ru"
        token = secrets.token_hex(12)
        SavedSearch.objects.create(token=token, filters=filters, language=language)
        username = settings.TELEGRAM_BOT_USERNAME
        return Response({
            "token": token, "start_command": f"/start s_{token}",
            "link": f"https://t.me/{username}?start=s_{token}" if username else None,
        }, status=201)

    @action(detail=True, methods=["get"])
    def similar(self, request, pk=None):
        """Похожие объявления: тот же тип и близкая цена; не больше SIMILAR_LIMIT."""
        prop = self.get_object()
        candidates = list(available_properties().exclude(pk=prop.pk).order_by("-updated_at", "-id")[:200])
        candidates.sort(key=lambda p: (p.kind != prop.kind, abs((p.listing_price or 0) - (prop.listing_price or 0))))
        data = self.get_serializer(candidates[:SIMILAR_LIMIT], many=True).data
        return Response(data)

    @action(detail=True, methods=["get"], url_path=r"photos/(?P<photo_id>\d+)")
    def photo(self, request, pk=None, photo_id=None):
        prop = self.get_object()  # 404, если объект не опубликован
        doc = next((d for d in prop.photos if d.pk == int(photo_id)), None)
        if doc is None:
            raise Http404
        if not isinstance(doc.file.storage, FileSystemStorage):
            return HttpResponseRedirect(doc.file.url)
        response = FileResponse(doc.file.open("rb"), content_type=doc.content_type)
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "public, max-age=3600"
        return response
