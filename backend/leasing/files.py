from django.core.files.storage import FileSystemStorage
from django.db import transaction
from django.http import FileResponse, HttpResponseRedirect
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser

from core.audit import log_action
from core.mixins import OwnedPrimaryKeyRelatedField, OwnedQuerysetMixin

from .models import Document, Lease, Property, Tenant
from .uploads import validate_upload


class DocumentSerializer(serializers.ModelSerializer):
    property = OwnedPrimaryKeyRelatedField(queryset=Property.objects.all(), required=False, allow_null=True)
    lease = OwnedPrimaryKeyRelatedField(queryset=Lease.objects.all(), required=False, allow_null=True)
    tenant = OwnedPrimaryKeyRelatedField(queryset=Tenant.objects.all(), required=False, allow_null=True)
    file = serializers.FileField(write_only=True)

    class Meta:
        model = Document
        fields = ("id", "kind", "property", "lease", "tenant", "file", "original_name", "content_type",
                  "size", "created_at")
        read_only_fields = ("id", "original_name", "content_type", "size", "created_at")

    def validate(self, attrs):
        targets = [attrs.get(name) for name in ("property", "lease", "tenant")]
        if sum(t is not None for t in targets) != 1:
            raise serializers.ValidationError(
                {"non_field_errors": ["Укажите ровно одну привязку: объект, договор или арендатор."]}
            )
        if attrs.get("kind") == Document.Kind.PHOTO and attrs.get("property") is None:
            raise serializers.ValidationError({"kind": ["Фото можно прикрепить только к объекту."]})
        file = attrs["file"]
        attrs["content_type"] = validate_upload(file, attrs.get("kind", Document.Kind.DOCUMENT))
        attrs["original_name"] = file.name.replace("\\", "/").rsplit("/", 1)[-1][:255]
        attrs["size"] = file.size
        return attrs


class DocumentViewSet(OwnedQuerysetMixin, mixins.CreateModelMixin, mixins.ListModelMixin,
                      mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    parser_classes = [MultiPartParser, FormParser]
    filterset_fields = ("kind", "property", "lease", "tenant")

    def perform_create(self, serializer):
        with transaction.atomic():
            doc = serializer.save(owner=self.request.user)
            log_action(self.request.user, "document.uploaded", doc, actor=self.request.user,
                       name=doc.original_name, size=doc.size)

    def perform_destroy(self, instance):
        storage, name = instance.file.storage, instance.file.name
        with transaction.atomic():
            log_action(self.request.user, "document.deleted", instance, actor=self.request.user,
                       name=instance.original_name)
            instance.delete()
            transaction.on_commit(lambda: storage.delete(name))

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        doc = self.get_object()  # 404 для чужого файла
        if not isinstance(doc.file.storage, FileSystemStorage):
            return HttpResponseRedirect(doc.file.url)  # короткоживущая подписанная ссылка S3
        response = FileResponse(doc.file.open("rb"), as_attachment=True, filename=doc.original_name,
                                content_type=doc.content_type)
        response["X-Content-Type-Options"] = "nosniff"
        return response
