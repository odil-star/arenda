"""Преимущества жильца от тарифа арендодателя (Prime/VIP): значок, бланк в квитанции, приоритет, напоминание о заявке."""
import shutil
import tempfile
from datetime import timedelta
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from leasing.models import ContractBrand
from leasing.receipt_doc import render_receipt_html
from portal.models import RepairRequest
from portal.services import create_tenant_user
from portal.tasks import nudge_stale_repairs
from support.models import SupportMessage, SupportThread
from users.models import User

from .models import Plan, Subscription
from .testing import OwnerTestCase

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def give(user, tier):
    plan, _ = Plan.objects.get_or_create(name=f"T-{tier}", defaults={"tier": tier})
    Subscription.objects.update_or_create(user=user, defaults={"plan": plan})
    user.refresh_from_db()


class TenantPerksBase(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.media = tempfile.mkdtemp()
        override = override_settings(MEDIA_ROOT=self.media)
        override.enable()
        self.addCleanup(override.disable)
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)

    def resident_of(self, owner, email):
        user = create_tenant_user(email=email, password="Tenant-pass-123")
        tenant = self.make_tenant(owner=owner, name=f"Жилец {email}")
        tenant.user = user
        tenant.save()
        return user, tenant

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client


class TierBadgeTests(TenantPerksBase):
    def test_tenant_sees_landlord_tier(self):
        user, _ = self.resident_of(self.user_a, "t1@example.com")
        self.assertEqual(self.as_(user).get("/api/tenant/me/").json()["landlords"][0]["landlord_tier"], "free")
        give(self.user_a, "prime")
        self.assertEqual(self.as_(user).get("/api/tenant/me/").json()["landlords"][0]["landlord_tier"], "prime")
        give(self.user_a, "vip")
        self.assertEqual(self.as_(user).get("/api/tenant/me/").json()["landlords"][0]["landlord_tier"], "vip")


class ReceiptBrandTests(TenantPerksBase):
    def setUp(self):
        super().setUp()
        brand = ContractBrand.objects.create(user=self.user_a, company_name="Ромашка Недвижимость")
        brand.logo.save("l.png", SimpleUploadedFile("l.png", PNG), save=True)
        today = timezone.localdate()
        lease = self.make_lease(start=today - timedelta(days=40), end=today + timedelta(days=60))
        self.payment = lease.payments.order_by("due_date").first()
        self.payment.amount_paid = self.payment.amount_due
        self.payment.save()

    def html(self):
        from leasing.models import Payment

        return render_receipt_html(Payment.objects.select_related("owner", "lease__tenant", "lease__property").get(pk=self.payment.pk))

    def test_brand_on_receipt_only_for_prime_and_up(self):
        self.assertNotIn("Ромашка Недвижимость", self.html())
        give(self.user_a, "prime")
        html = self.html()
        self.assertIn("Ромашка Недвижимость", html)
        self.assertIn("data:image/png;base64,", html)
        give(self.user_a, "vip")
        self.assertIn("Ромашка Недвижимость", self.html())


class SupportPriorityForTenantsTests(TenantPerksBase):
    def write(self, user, body):
        thread, _ = SupportThread.objects.get_or_create(user=user)
        SupportMessage.objects.create(thread=thread, author=user, body=body)
        thread.last_message_at = timezone.now()
        thread.save()

    def test_tenants_of_prime_landlord_are_prioritised(self):
        prime_tenant, _ = self.resident_of(self.user_a, "p@example.com")
        free_tenant, _ = self.resident_of(self.user_b, "f@example.com")
        give(self.user_a, "prime")
        self.write(prime_tenant, "жилец Prime, раньше")
        self.write(free_tenant, "жилец Free, позже")
        admin = User.objects.create_superuser("root@example.com", self.password)
        self.login(admin)
        rows = self.client.get("/api/admin/support/threads/").json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        self.assertEqual([r["user_email"] for r in rows], ["p@example.com", "f@example.com"])
        self.assertEqual([r["priority"] for r in rows], [True, False])


class RepairNudgeTests(TenantPerksBase):
    def repair(self, owner, hours_old, status=RepairRequest.Status.NEW):
        user, tenant = self.resident_of(owner, f"r{RepairRequest.objects.count()}@example.com")
        lease = self.make_lease(owner=owner, tenant=tenant, prop=self.make_property(owner=owner, name="Кв"))
        item = RepairRequest.objects.create(owner=owner, lease=lease, title="Течёт кран", status=status)
        RepairRequest.objects.filter(pk=item.pk).update(created_at=timezone.now() - timedelta(hours=hours_old))
        return item

    def run_task(self):
        with mock.patch("reminders.services.notify_owner_event") as notify:
            sent = nudge_stale_repairs()
        return sent, notify

    def test_prime_nudged_after_48h_not_before(self):
        give(self.user_a, "prime")
        self.repair(self.user_a, 47)
        self.assertEqual(self.run_task()[0], 0)
        self.repair(self.user_a, 49)
        sent, notify = self.run_task()
        self.assertEqual(sent, 1)
        text = notify.call_args.kwargs["text"]
        self.assertIn("48", text)
        self.assertIn("Течёт кран", text)

    def test_vip_nudged_after_24h(self):
        give(self.user_a, "vip")
        self.repair(self.user_a, 25)
        self.assertEqual(self.run_task()[0], 1)

    def test_free_owner_and_answered_requests_are_not_nudged(self):
        self.repair(self.user_a, 100)  # Free
        give(self.user_b, "vip")
        self.repair(self.user_b, 100, status=RepairRequest.Status.IN_PROGRESS)
        self.assertEqual(self.run_task()[0], 0)

    def test_dedupe_key_is_per_request(self):
        give(self.user_a, "vip")
        item = self.repair(self.user_a, 30)
        _, notify = self.run_task()
        self.assertEqual(notify.call_args.kwargs["key"], f"repair-nudge:{item.pk}")
