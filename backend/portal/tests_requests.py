import shutil
import tempfile
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from leasing.models import Lease

from .models import LeaseRequest, TenantMeterReading, RepairRequest, TenantNotification
from .tests import PNG, PortalCase, png


class RequestsCase(PortalCase):
    def setUp(self):
        super().setUp()
        media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, media, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=media)
        override.enable()
        self.addCleanup(override.disable)
        self.tenant = self.make_tenant(name="Жилец 1")
        self.lease = self.make_lease(tenant=self.tenant)
        self.user = self.make_tenant_user()
        self.tenant.user = self.user
        self.tenant.save()
        self.tc = self.client_for(self.user)
        # чужой жилец того же арендодателя
        other = self.make_tenant(name="Жилец 2")
        self.other_lease = self.make_lease(tenant=other)
        self.other_user = self.make_tenant_user("other@example.com")
        other.user = self.other_user
        other.save()
        self.oc = self.client_for(self.other_user)


class RepairTests(RequestsCase):
    def test_create_with_photo_and_landlord_flow(self):
        r = self.tc.post("/api/tenant/repairs/", {"lease": self.lease.pk, "title": "Течёт кран",
                                                  "description": "На кухне", "photo": png("a.png")},
                         format="multipart")
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual((body["status"], body["has_photo"]), ("new", True))
        self.assertEqual(self.tc.get(f"/api/tenant/repairs/{body['id']}/photo/").status_code, 200)
        self.assertEqual(self.oc.get(f"/api/tenant/repairs/{body['id']}/photo/").status_code, 404)

        self.login(self.user_a)
        self.assertEqual(self.client.get("/api/repairs/").json()["count"], 1)
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post(f"/api/repairs/{body['id']}/set-status/",
                                 {"status": "done", "landlord_comment": "Починили"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "done")
        self.assertIsNotNone(RepairRequest.objects.get(pk=body["id"]).resolved_at)
        self.assertTrue(TenantNotification.objects.filter(user=self.user, kind="repair_updated").exists())

    def test_isolation(self):
        self.tc.post("/api/tenant/repairs/", {"lease": self.lease.pk, "title": "x"}, format="multipart")
        self.assertEqual(self.oc.get("/api/tenant/repairs/").json()["count"], 0)
        r = self.oc.post("/api/tenant/repairs/", {"lease": self.lease.pk, "title": "чужой"}, format="multipart")
        self.assertEqual(r.status_code, 404)
        self.login(self.user_b)
        self.assertEqual(self.client.get("/api/repairs/").json()["count"], 0)
        item = RepairRequest.objects.get()
        self.assertEqual(self.client.post(f"/api/repairs/{item.pk}/set-status/", {"status": "done"},
                                          format="json").status_code, 404)

    def test_rejects_non_image_and_ended_lease(self):
        r = self.tc.post("/api/tenant/repairs/", {"lease": self.lease.pk, "title": "x", "photo": png("a.png", b"junk")},
                         format="multipart")
        self.assertEqual(r.status_code, 400)
        Lease.objects.filter(pk=self.lease.pk).update(status="ended")
        r = self.tc.post("/api/tenant/repairs/", {"lease": self.lease.pk, "title": "x"}, format="multipart")
        self.assertEqual(r.status_code, 400)

    def test_open_limit(self):
        for i in range(10):
            self.assertEqual(self.tc.post("/api/tenant/repairs/", {"lease": self.lease.pk, "title": f"t{i}"},
                                          format="multipart").status_code, 201)
        r = self.tc.post("/api/tenant/repairs/", {"lease": self.lease.pk, "title": "ещё"}, format="multipart")
        self.assertEqual(r.status_code, 400)

    def test_landlord_cannot_use_tenant_endpoint(self):
        self.login(self.user_a)
        self.assertEqual(self.client.get("/api/tenant/repairs/").status_code, 403)
        self.assertEqual(self.tc.get("/api/repairs/").status_code, 403)


class MeterTests(RequestsCase):
    def post(self, kind="electricity", value=100, client=None, **extra):
        return (client or self.tc).post("/api/tenant/meter-readings/",
                                        {"lease": self.lease.pk, "kind": kind, "value": value, **extra},
                                        format="multipart")

    def test_submit_and_replace_in_same_month(self):
        self.assertEqual(self.post(value=100).status_code, 201)
        self.assertEqual(self.post(value=120).status_code, 201)
        self.assertEqual(TenantMeterReading.objects.count(), 1)
        self.assertEqual(TenantMeterReading.objects.get().value, 120)
        from finance.models import MeterReading as FinanceMeter

        mirrored = FinanceMeter.objects.get()  # то же показание попало в учёт счётчиков арендодателя
        self.assertEqual((mirrored.owner_id, mirrored.property_id, int(mirrored.value)),
                         (self.user_a.pk, self.lease.property_id, 120))

    def test_not_less_than_previous(self):
        prev = timezone.localdate().replace(day=1) - timedelta(days=1)
        TenantMeterReading.objects.create(owner=self.user_a, lease=self.lease, kind="gas", period=prev.replace(day=1),
                                    value=500)
        self.assertEqual(self.post("gas", 400).status_code, 400)
        self.assertEqual(self.post("gas", 500).status_code, 201)

    def test_photo_and_isolation(self):
        r = self.post(photo=png("m.png"))
        self.assertTrue(r.json()["has_photo"])
        pk = r.json()["id"]
        self.assertEqual(self.tc.get(f"/api/tenant/meter-readings/{pk}/photo/").status_code, 200)
        self.assertEqual(self.oc.get(f"/api/tenant/meter-readings/{pk}/photo/").status_code, 404)
        self.assertEqual(self.oc.get("/api/tenant/meter-readings/").json()["count"], 0)
        self.login(self.user_a)
        self.assertEqual(self.client.get("/api/tenant-meter-readings/").json()["count"], 1)
        self.login(self.user_b)
        self.assertEqual(self.client.get("/api/tenant-meter-readings/").json()["count"], 0)

    def test_negative_rejected(self):
        self.assertEqual(self.post(value=-1).status_code, 400)


class LeaseRequestTests(RequestsCase):
    def post(self, **body):
        return self.tc.post("/api/tenant/lease-requests/", {"lease": self.lease.pk, **body}, format="json")

    def test_extend_accept(self):
        r = self.post(kind="extend", months=6)
        self.assertEqual(r.status_code, 201, r.content)
        pk = r.json()["id"]
        self.assertEqual(self.post(kind="extend", months=3).status_code, 400)  # одна ожидающая
        self.login(self.user_a)
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post(f"/api/lease-requests/{pk}/accept/", {"comment": "ок"}, format="json")
        self.assertEqual(r.json()["status"], "accepted")
        self.assertEqual(self.client.post(f"/api/lease-requests/{pk}/decline/", {}, format="json").status_code, 400)
        self.assertTrue(TenantNotification.objects.filter(user=self.user, kind="request_resolved").exists())
        self.assertEqual(self.post(kind="extend", months=3).status_code, 201)  # после ответа можно снова

    def test_extend_needs_months_and_leave_needs_date(self):
        self.assertEqual(self.post(kind="extend").status_code, 400)
        self.assertEqual(self.post(kind="leave").status_code, 400)
        yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
        self.assertEqual(self.post(kind="leave", move_out_date=yesterday).status_code, 400)
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
        self.assertEqual(self.post(kind="leave", move_out_date=tomorrow).status_code, 201)

    def test_cancel_and_isolation(self):
        pk = self.post(kind="extend", months=2).json()["id"]
        self.assertEqual(self.oc.post(f"/api/tenant/lease-requests/{pk}/cancel/").status_code, 404)
        self.login(self.user_b)
        self.assertEqual(self.client.post(f"/api/lease-requests/{pk}/accept/", {}, format="json").status_code, 404)
        self.assertEqual(self.tc.post(f"/api/tenant/lease-requests/{pk}/cancel/").status_code, 204)
        self.assertEqual(LeaseRequest.objects.get(pk=pk).status, "cancelled")


class LeaseContactsTests(RequestsCase):
    def test_contacts_and_rules_in_tenant_lease(self):
        prop = self.lease.property
        prop.house_rules = "Wi-Fi: home / 12345"
        prop.contact_phone = "+998901112233"
        prop.save()
        item = self.tc.get("/api/tenant/leases/").json()["results"][0]
        self.assertEqual(item["house_rules"], "Wi-Fi: home / 12345")
        self.assertEqual(item["landlord_phone"], "+998901112233")
        self.assertIn("landlord_telegram", item)


class PhotoRetentionTests(RequestsCase):
    def test_photos_deleted_after_three_days(self):
        from .tenant_requests import purge_old_photos

        repair = self.tc.post("/api/tenant/repairs/", {"lease": self.lease.pk, "title": "x", "photo": png("a.png")},
                              format="multipart").json()
        meter = self.tc.post("/api/tenant/meter-readings/", {"lease": self.lease.pk, "kind": "gas", "value": 5,
                                                              "photo": png("m.png")}, format="multipart").json()
        path = RepairRequest.objects.get(pk=repair["id"]).photo.path
        import os

        self.assertTrue(os.path.exists(path))
        self.assertEqual(purge_old_photos(), 0)  # свежие не трогаем
        self.assertEqual(purge_old_photos(timezone.now() + timedelta(days=2, hours=23)), 0)
        self.assertEqual(purge_old_photos(timezone.now() + timedelta(days=3, minutes=1)), 2)
        self.assertFalse(os.path.exists(path))
        self.assertFalse(self.tc.get("/api/tenant/repairs/").json()["results"][0]["has_photo"])
        self.assertEqual(self.tc.get(f"/api/tenant/repairs/{repair['id']}/photo/").status_code, 404)
        self.assertEqual(self.tc.get(f"/api/tenant/meter-readings/{meter['id']}/photo/").status_code, 404)
        self.assertEqual(RepairRequest.objects.count(), 1)  # сама заявка остаётся
