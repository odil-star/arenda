from django.urls import include, path
from rest_framework.routers import DefaultRouter

from core.views import AuditLogViewSet

from .brand import ContractBrandView
from .files import DocumentViewSet
from .listings import ListingViewSet
from .views import DashboardView, LeaseViewSet, PaymentViewSet, PropertyViewSet, TenantViewSet

router = DefaultRouter()
router.include_root_view = False
router.register("properties", PropertyViewSet, basename="property")
router.register("tenants", TenantViewSet, basename="tenant")
router.register("leases", LeaseViewSet, basename="lease")
router.register("payments", PaymentViewSet, basename="payment")
router.register("documents", DocumentViewSet, basename="document")
router.register("audit", AuditLogViewSet, basename="audit")
router.register("listings", ListingViewSet, basename="listing")

urlpatterns = [
    path("dashboard/", DashboardView.as_view()),
    path("contract-brand/", ContractBrandView.as_view()),
    path("", include(router.urls)),
]
