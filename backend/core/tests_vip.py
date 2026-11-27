"""Эксклюзивные возможности VIP."""
import shutil
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from leasing.models import ContractBrand
from portal.services import create_tenant_user

from .models import Plan, Subscription
from .testing import OwnerTestCase
from .tiers import tier_info

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def give(user, tier, paid_until=None, **extra):
    plan, _ = Plan.objects.get_or_create(name=f"T-{tier}", defaults={"tier": tier})
    Subscription.objects.update_or_create(user=user, defaults={"plan": plan, "paid_until": paid_until, **extra})
    user.refresh_from_db()  # в проде каждый запрос грузит пользователя заново; в тесте сбрасываем кэш связи


class ManagerTests(OwnerTestCase):
    def test_manager_visible_only_on_active_vip(self):
        give(self.user_a, "prime", manager_name="Алишер", manager_contact="@alisher")
        self.assertIsNone(tier_info(self.user_a)["manager"])
        give(self.user_a, "vip", manager_name="Алишер", manager_contact="@alisher")
        self.assertEqual(tier_info(self.user_a)["manager"], {"name": "Алишер", "contact": "@alisher"})
        give(self.user_a, "vip", timezone.localdate() - timedelta(days=1), manager_name="Алишер")
        self.assertIsNone(tier_info(self.user_a)["manager"])

    def test_vip_without_manager_has_none(self):
        give(self.user_a, "vip")
        self.assertIsNone(self.client.get("/api/me/").json()["subscription"]["manager"])

    def test_me_exposes_manager(self):
        give(self.user_a, "vip", manager_name="Алишер", manager_contact="+998901234567")
        self.assertEqual(self.client.get("/api/me/").json()["subscription"]["manager"]["name"], "Алишер")


class FeaturedListingsTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(None)

    def ad(self, owner, name):
        return self.make_property(owner=owner, name=name, is_listed=True, listing_price=1_000_000)

    def test_vip_above_prime_above_free(self):
        from users.models import User
        vip = self.user_b
        prime = User.objects.create_user("p@example.com", self.password)
        for i in range(2):
            self.ad(self.user_a, f"F{i}")  # Free
        self.ad(prime, "P0")
        self.ad(vip, "V0")
        give(prime, "prime")
        give(vip, "vip")
        rows = self.client.get("/api/listings/").json()["results"]
        self.assertEqual([r["title"] for r in rows[:2]], ["V0", "P0"])
        self.assertEqual([r["boost_tier"] for r in rows], ["vip", "prime", None, None])
        self.assertEqual([r["boosted"] for r in rows], [True, True, False, False])

    def test_all_vip_ads_always_on_top_even_with_sorting(self):
        for i in range(7):
            self.ad(self.user_b, f"V{i}")  # все объявления VIP — наверху, без лимита
        give(self.user_b, "vip")
        cheap = self.ad(self.user_a, "F0")
        cheap.listing_price = 1
        cheap.save()
        for params in ({}, {"ordering": "listing_price"}, {"ordering": "-listing_price"}):
            rows = self.client.get("/api/listings/", params).json()["results"]
            self.assertEqual([r["boost_tier"] for r in rows], ["vip"] * 7 + [None], params)
        asc = self.client.get("/api/listings/", {"ordering": "listing_price"}).json()["results"]
        self.assertEqual(asc[-1]["title"], "F0")  # самый дешёвый, но не VIP — после всех VIP


class WhiteLabelTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.media = tempfile.mkdtemp()
        override = override_settings(MEDIA_ROOT=self.media)
        override.enable()
        self.addCleanup(override.disable)
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        self.tenant = self.make_tenant()
        self.resident = create_tenant_user(email="res@example.com", password="Tenant-pass-123")
        self.tenant.user = self.resident
        self.tenant.save()
        brand = ContractBrand.objects.create(user=self.user_a, company_name="Ромашка")
        brand.logo.save("logo.png", SimpleUploadedFile("logo.png", PNG), save=True)
        self.tclient = APIClient()
        self.tclient.force_authenticate(self.resident)

    def brands(self):
        return self.tclient.get("/api/tenant/me/").json()["brands"]

    def test_only_vip_owner_brand_reaches_tenant(self):
        self.assertEqual(self.brands(), [])
        give(self.user_a, "prime")
        self.assertEqual(self.brands(), [])
        give(self.user_a, "vip")
        self.assertEqual(self.brands(), [{"tenant": self.tenant.pk, "name": "Ромашка", "has_logo": True}])

    def test_logo_served_to_own_tenant_only(self):
        url = f"/api/tenant/brand/{self.tenant.pk}/logo/"
        self.assertEqual(self.tclient.get(url).status_code, 404)  # владелец не VIP
        give(self.user_a, "vip")
        r = self.tclient.get(url)
        self.assertEqual((r.status_code, r["Content-Type"]), (200, "image/png"))
        stranger = APIClient()
        stranger.force_authenticate(create_tenant_user(email="other@example.com", password="Tenant-pass-123"))
        self.assertEqual(stranger.get(url).status_code, 404)

    def test_brand_expires_with_vip(self):
        give(self.user_a, "vip", timezone.localdate() - timedelta(days=1))
        self.assertEqual(self.brands(), [])
