from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ExpenseViewSet, MeterReadingViewSet, ReportExportView, ReportSummaryView

router = DefaultRouter()
router.include_root_view = False
router.register("meter-readings", MeterReadingViewSet, basename="meter-reading")
router.register("expenses", ExpenseViewSet, basename="expense")

urlpatterns = [
    path("reports/summary/", ReportSummaryView.as_view()),
    path("reports/export/", ReportExportView.as_view()),
    path("", include(router.urls)),
]
