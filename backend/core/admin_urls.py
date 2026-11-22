from django.urls import path
from rest_framework.routers import DefaultRouter

from .admin_api import AdminAuditViewSet, AdminStatsView, AdminTransactionViewSet, AdminUserViewSet
from .admin_extra import (
    AdminAdminViewSet, AdminDailyStatsView, AdminLeaseViewSet, AdminMessageViewSet, AdminTenantViewSet,
)
from support.views import AdminPresenceView, AdminSupportThreadViewSet

from .admin_platform import (
    AdminAnnouncementViewSet, AdminNoteViewSet, AdminPlanViewSet, AdminSystemView, AdminWebhookLogViewSet,
)

router = DefaultRouter()
router.register("users", AdminUserViewSet, basename="admin-users")
router.register("audit", AdminAuditViewSet, basename="admin-audit")
router.register("transactions", AdminTransactionViewSet, basename="admin-transactions")
router.register("tenants", AdminTenantViewSet, basename="admin-tenants")
router.register("leases", AdminLeaseViewSet, basename="admin-leases")
router.register("messages", AdminMessageViewSet, basename="admin-messages")
router.register("admins", AdminAdminViewSet, basename="admin-admins")
router.register("webhooks", AdminWebhookLogViewSet, basename="admin-webhooks")
router.register("announcements", AdminAnnouncementViewSet, basename="admin-announcements")
router.register("notes", AdminNoteViewSet, basename="admin-notes")
router.register("plans", AdminPlanViewSet, basename="admin-plans")
router.register("support/threads", AdminSupportThreadViewSet, basename="admin-support")

urlpatterns = [
    path("stats/", AdminStatsView.as_view()),
    path("stats/daily/", AdminDailyStatsView.as_view()),
    path("system/", AdminSystemView.as_view()),
    path("support/presence/", AdminPresenceView.as_view()),
    *router.urls,
]
