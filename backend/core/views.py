from rest_framework import serializers, viewsets

from .mixins import OwnedQuerysetMixin
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = ("id", "action", "object_type", "object_id", "details", "created_at")


class AuditLogViewSet(OwnedQuerysetMixin, viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    filterset_fields = ("action", "object_type", "object_id")
