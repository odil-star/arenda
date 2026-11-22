from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from django.http import HttpResponse
from rest_framework import serializers, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from core.audit import log_action
from core.mixins import OwnedQuerysetMixin
from leasing.models import Property
from leasing.views import OwnedModelViewSet

from . import reports
from .models import Expense, MeterReading
from .serializers import ExpenseSerializer, MeterReadingSerializer


class MeterReadingViewSet(OwnedModelViewSet):
    queryset = MeterReading.objects.select_related("property")
    serializer_class = MeterReadingSerializer
    filterset_fields = ("property", "meter")
    ordering_fields = ("reading_date",)


class ExpenseViewSet(OwnedModelViewSet):
    queryset = Expense.objects.select_related("property")
    serializer_class = ExpenseSerializer
    filterset_fields = ("property", "category", "expense_date")
    ordering_fields = ("expense_date", "amount")


class ReportQuerySerializer(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    property = serializers.IntegerField(required=False)
    file = serializers.ChoiceField(choices=["csv", "xlsx"], required=False)

    def validate(self, attrs):
        default_from, default_to = reports.default_period()
        attrs.setdefault("date_from", default_from)
        attrs.setdefault("date_to", default_to)
        if attrs["date_from"] > attrs["date_to"]:
            raise serializers.ValidationError({"date_to": ["Конец периода раньше его начала."]})
        if (attrs["date_to"] - attrs["date_from"]).days > 366:
            raise serializers.ValidationError({"date_to": ["Период не может быть длиннее 366 дней."]})
        return attrs


class ReportMixin:
    def build(self, request):
        query = ReportQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        data = query.validated_data
        prop = data.get("property")
        if prop is not None and not Property.objects.filter(pk=prop, owner=request.user).exists():
            raise serializers.ValidationError({"property": ["Объект не найден."]})
        return data, reports.build_report(request.user, data["date_from"], data["date_to"], prop)


class ReportSummaryView(ReportMixin, APIView):
    """GET /api/reports/summary/?date_from=&date_to=&property= — доход / расход / прибыль."""

    @extend_schema(parameters=[ReportQuerySerializer], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        _, report = self.build(request)
        return Response(report)


class ReportExportView(ReportMixin, APIView):
    """GET /api/reports/export/?file=csv|xlsx — тот же отчёт файлом."""

    @extend_schema(parameters=[ReportQuerySerializer], responses=OpenApiTypes.BINARY)
    def get(self, request):
        data, report = self.build(request)
        kind = data.get("file", "csv")
        name = f"report-{data['date_from']}-{data['date_to']}.{kind}"
        if kind == "xlsx":
            body = reports.to_xlsx(report)
            content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        else:
            body, content_type = reports.to_csv(report), "text/csv; charset=utf-8"
        log_action(request.user, "report.exported", None, actor=request.user, file=kind)
        response = HttpResponse(body, content_type=content_type)
        response["Content-Disposition"] = f'attachment; filename="{name}"'
        return response
