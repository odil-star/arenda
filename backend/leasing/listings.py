"""Публичный поиск квартир.

Гость видит только объекты, которые владелец сам разрешил показывать (is_listed),
не на ремонте и без действующего договора. Связь — напрямую с владельцем: звонок или сообщение.
"""
from django.core.files.storage import FileSystemStorage
from django.db.models import Count, Exists, OuterRef, Prefetch
from django.http import FileResponse, Http404, HttpResponseRedirect
from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from portal.throttling import IPWindowThrottle

from .models import Document, Lease, Property


SIMILAR_LIMIT = 10


class ListingBrowseThrottle(IPWindowThrottle):
    scope, limit, window = "listing_browse", 240, 60


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


class ListingSerializer(serializers.ModelSerializer):
    title = serializers.CharField(source="name")
    price = serializers.IntegerField(source="listing_price")
    description = serializers.CharField(source="listing_description")
    phone = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    owner_since = serializers.SerializerMethodField()
    owner_listings = serializers.SerializerMethodField()
    photos = serializers.SerializerMethodField()

    class Meta:
        model = Property
        fields = ("id", "title", "address", "kind", "area_m2", "rooms", "price", "description", "phone", "has_telegram",
                  "floor", "floors_total", "renovation", "furniture", "amenities", "owner", "owner_name", "owner_since",
                  "owner_listings", "photos", "created_at", "updated_at")

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
    """GET /api/listings/ — свободные объекты; ?kind=&rooms=&price_max=&search="""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ListingBrowseThrottle]
    serializer_class = ListingSerializer
    filterset_fields = ("kind", "rooms", "owner")
    search_fields = ("name", "address", "listing_description")
    ordering_fields = ("listing_price", "updated_at", "area_m2")
    ordering = ("-updated_at", "-id")

    def get_queryset(self):
        qs = available_properties()
        params = self.request.query_params
        for name, lookup in (("price_min", "listing_price__gte"), ("price_max", "listing_price__lte")):
            value = params.get(name, "")
            if value.isdigit():
                qs = qs.filter(**{lookup: int(value)})
        return qs

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
