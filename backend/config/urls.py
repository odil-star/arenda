from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from core.admin_platform import ActiveAnnouncementsView
from core.health import health

# Файлы (документы, фото) намеренно НЕ раздаются как /media/: доступ только через
# /api/documents/{id}/download/ с проверкой владельца.
urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/admin/", include("core.admin_urls")),
    path("api/announcements/", ActiveAnnouncementsView.as_view()),
    path("api/", include("users.urls")),
    path("api/", include("billing.urls")),
    path("api/", include("leasing.urls")),
    path("api/", include("finance.urls")),
    path("api/", include("portal.urls")),
    path("api/", include("support.urls")),
]

urlpatterns += [path("api/health/", health)]
if settings.API_DOCS_ENABLED:
    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    ]
