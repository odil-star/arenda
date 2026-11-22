import os
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from core.models import AuditLog
from core.testing import OwnerTestCase

from .models import Document

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 32


class DocumentTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.media = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()
        self.prop = self.make_property()

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media, ignore_errors=True)
        super().tearDown()

    def upload(self, name="scan.pdf", content=PDF, **data):
        data.setdefault("property", self.prop.pk)
        return self.client.post("/api/documents/", {"file": SimpleUploadedFile(name, content), **data},
                                format="multipart")

    def test_upload_download_roundtrip(self):
        r = self.upload()
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertNotIn("file", body)
        self.assertEqual((body["content_type"], body["original_name"], body["size"]),
                         ("application/pdf", "scan.pdf", len(PDF)))
        doc = Document.objects.get(pk=body["id"])
        self.assertEqual(doc.owner, self.user_a)
        self.assertTrue(doc.file.name.startswith(f"documents/{self.user_a.pk}/"))
        self.assertNotIn("scan", doc.file.name)  # имя файла на диске случайное
        dl = self.client.get(f"/api/documents/{doc.pk}/download/")
        self.assertEqual(dl.status_code, 200)
        self.assertEqual(b"".join(dl.streaming_content), PDF)
        self.assertEqual(dl["X-Content-Type-Options"], "nosniff")
        self.assertTrue(AuditLog.objects.filter(action="document.uploaded", object_id=doc.pk).exists())

    def test_photo_for_property_only(self):
        self.assertEqual(self.upload("p.jpeg", JPG, kind="photo").status_code, 201)
        self.assertEqual(self.upload("p.png", PNG, kind="photo").status_code, 201)
        self.assertEqual(self.upload("p.pdf", PDF, kind="photo").status_code, 400)
        lease = self.make_lease()
        r = self.upload("p.png", PNG, kind="photo", property="", lease=lease.pk)
        self.assertEqual(r.status_code, 400)

    def test_type_checks(self):
        cases = [
            ("virus.exe", b"MZ\x90\x00" + b"\x00" * 20),    # исполняемый файл
            ("fake.pdf", b"MZ\x90\x00" + b"\x00" * 20),      # exe под видом pdf
            ("page.html", b"<html><script>alert(1)</script>"),
            ("image.pdf", PNG),                              # расширение не совпадает с содержимым
            ("empty.pdf", b""),
        ]
        for name, content in cases:
            r = self.upload(name, content)
            self.assertEqual(r.status_code, 400, name)
            self.assertIn("file", r.json(), name)
        self.assertEqual(Document.objects.count(), 0)
        self.assertEqual(os.listdir(self.media), [])

    @override_settings(UPLOAD_MAX_DOCUMENT_BYTES=100, UPLOAD_MAX_PHOTO_BYTES=50)
    def test_size_limits(self):
        self.assertEqual(self.upload("a.pdf", PDF + b"0" * 100).status_code, 400)
        self.assertEqual(self.upload("a.png", PNG + b"0" * 30, kind="photo").status_code, 400)
        self.assertEqual(self.upload("ok.pdf", PDF).status_code, 201)

    def test_exactly_one_target_required(self):
        self.assertEqual(self.upload(property="").status_code, 400)
        tenant = self.make_tenant()
        self.assertEqual(self.upload(tenant=tenant.pk).status_code, 400)
        self.assertEqual(self.upload(property="", tenant=tenant.pk).status_code, 201)

    def test_cannot_attach_to_foreign_objects(self):
        foreign = self.make_property(self.user_b)
        r = self.upload(property=foreign.pk)
        self.assertEqual(r.status_code, 400)
        self.assertIn("property", r.json())
        self.assertEqual(Document.objects.count(), 0)

    def test_isolation_on_read_download_delete(self):
        doc_id = self.upload().json()["id"]
        self.login(self.user_b)
        self.assertEqual(self.client.get("/api/documents/").json()["count"], 0)
        for method, url in (("get", f"/api/documents/{doc_id}/"), ("get", f"/api/documents/{doc_id}/download/"),
                            ("delete", f"/api/documents/{doc_id}/")):
            self.assertEqual(getattr(self.client, method)(url).status_code, 404, url)
        self.assertTrue(Document.objects.filter(pk=doc_id).exists())

    def test_delete_removes_file_and_is_audited(self):
        doc_id = self.upload().json()["id"]
        path = Document.objects.get(pk=doc_id).file.path
        self.assertTrue(os.path.exists(path))
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.delete(f"/api/documents/{doc_id}/").status_code, 204)
        self.assertFalse(os.path.exists(path))
        self.assertTrue(AuditLog.objects.filter(action="document.deleted", object_id=doc_id).exists())

    def test_requires_auth_and_no_public_media_route(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/documents/").status_code, 401)
        self.assertEqual(self.client.get("/media/documents/x.pdf").status_code, 404)

    def test_list_filter(self):
        self.upload()
        self.upload("p.png", PNG, kind="photo")
        self.assertEqual(self.client.get("/api/documents/?kind=photo").json()["count"], 1)


class ContractTests(OwnerTestCase):
    def test_html_contains_data_and_escapes(self):
        self.user_a.first_name = "Алишер"
        self.user_a.save()
        tenant = self.make_tenant(name="<script>alert(1)</script>")
        lease = self.make_lease(tenant=tenant, rent=2_500_000)
        r = self.client.get(f"/api/leases/{lease.pk}/contract/?as=html")
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn("2 500 000", html)
        self.assertIn("Алишер", html)
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("&lt;script&gt;", html)

    def test_pdf_or_clear_503_when_engine_missing(self):
        lease = self.make_lease()
        r = self.client.get(f"/api/leases/{lease.pk}/contract/")
        try:
            import weasyprint  # noqa: F401
            engine = True
        except (ImportError, OSError):
            engine = False
        if engine:
            self.assertEqual(r.status_code, 200)
            self.assertTrue(r.content.startswith(b"%PDF"))
        else:
            self.assertEqual(r.status_code, 503)
            self.assertIn("detail", r.json())

    def test_foreign_lease_404_and_auth(self):
        foreign = self.make_lease(owner=self.user_b)
        self.assertEqual(self.client.get(f"/api/leases/{foreign.pk}/contract/?as=html").status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f"/api/leases/{foreign.pk}/contract/").status_code, 401)
