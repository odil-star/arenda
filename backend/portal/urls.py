from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import passkeys, telegram_auth, views

router = DefaultRouter()
router.include_root_view = False
router.register("receipts", views.ReceiptViewSet, basename="receipt")
router.register("lease-media", views.LeaseMediaViewSet, basename="lease-media")
router.register("repairs", views.RepairViewSet, basename="repair")
router.register("tenant-meter-readings", views.TenantMeterViewSet, basename="tenant-meter-reading")
router.register("lease-requests", views.LeaseRequestViewSet, basename="lease-request")

urlpatterns = [
    path("", include(router.urls)),
    path("tenant/payments/<int:pk>/receipts/", views.TenantReceiptCreateView.as_view()),
    path("invites/accept/", views.InviteAcceptView.as_view()),
    path("invites/<str:token>/", views.InvitePreviewView.as_view()),
    path("auth/register-tenant/", views.RegisterTenantView.as_view()),
    path("auth/phone/request/", views.PhoneRequestView.as_view()),
    path("auth/phone/verify/", views.PhoneVerifyView.as_view()),
    path("auth/phone/password/", views.PhonePasswordLoginView.as_view()),
    path("tenant/telegram-link/", views.TenantTelegramLinkView.as_view()),
    path("tenant/password/", views.TenantPasswordView.as_view()),
    path("tenant/media/", views.TenantMediaListView.as_view()),
    path("tenant/brand/<int:pk>/logo/", views.TenantBrandLogoView.as_view()),
    path("tenant/media/<int:pk>/file/", views.TenantMediaFileView.as_view()),
    path("tenant/notifications/", views.TenantNotificationListView.as_view()),
    path("tenant/notifications/read/", views.TenantNotificationReadView.as_view()),
    path("tenant/repairs/", views.TenantRepairListCreateView.as_view()),
    path("tenant/repairs/<int:pk>/photo/", views.TenantRepairPhotoView.as_view()),
    path("tenant/meter-readings/", views.TenantMeterListCreateView.as_view()),
    path("tenant/meter-readings/<int:pk>/photo/", views.TenantMeterPhotoView.as_view()),
    path("tenant/lease-requests/", views.TenantLeaseRequestListCreateView.as_view()),
    path("tenant/lease-requests/<int:pk>/cancel/", views.TenantLeaseRequestCancelView.as_view()),
    path("tenant/me/", views.TenantMeView.as_view()),
    path("tenant/leases/", views.TenantLeaseListView.as_view()),
    path("tenant/leases/<int:pk>/hide/", views.TenantLeaseHideView.as_view()),
    path("tenant/payments/", views.TenantPaymentListView.as_view()),
    path("tenant/payments/<int:pk>/receipt/", views.TenantPaymentReceiptPdfView.as_view()),
    path("auth/telegram/", telegram_auth.TelegramLoginView.as_view()),
    path("auth/passkeys/register/options/", passkeys.RegisterOptionsView.as_view()),
    path("auth/passkeys/register/verify/", passkeys.RegisterVerifyView.as_view()),
    path("auth/passkeys/login/options/", passkeys.LoginOptionsView.as_view()),
    path("auth/passkeys/login/verify/", passkeys.LoginVerifyView.as_view()),
    path("auth/passkeys/", passkeys.PasskeyListView.as_view()),
    path("auth/passkeys/<int:pk>/", passkeys.PasskeyDetailView.as_view()),
    path("push/key/", views.PushKeyView.as_view()),
    path("push/subscription/", views.PushSubscribeView.as_view()),
]
