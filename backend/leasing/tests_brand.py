"""Prime: свой бланк договора."""
import shutil
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone

from core.models import Plan, Subscription
from core.testing import OwnerTestCase

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
URL = "/api/contract-brand/"


def logo(name="logo.png", data=PNG):
    return SimpleUploadedFile(name, data, content_type="image/png")


def give_prime(user, paid_until=None):
    plan, _ = Plan.objects.get_or_create(name="Prime", defaults={"tier": "prime"})
    Subscription.objects.update_or_create(user=user, defaults={"plan": plan, "paid_until": paid_until})
    user.refresh_from_db()  # в проде каждый запрос грузит пользователя заново; в тесте сбрасываем кэш связи


class BrandTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.media = tempfile.mkdtemp()
        override = override_settings(MEDIA_ROOT=self.media)
        override.enable()
        self.addCleanup(override.disable)
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        self.lease = self.make_lease()

    def html(self):
        return self.client.get(f"/api/leases/{self.lease.pk}/contract/?as=html").content.decode()

    def save(self, **fields):
        return self.client.put(URL, fields, format="multipart")

    def test_free_cannot_edit_but_can_read(self):
        self.assertEqual(self.save(company_name="ООО Ромашка").status_code, 403)
        data = self.client.get(URL).json()
        self.assertEqual((data["available"], data["company_name"], data["has_logo"]), (False, "", False))

    def test_prime_brand_appears_in_contract(self):
        give_prime(self.user_a)
        r = self.save(company_name="ООО Ромашка", requisites="ИНН 123456789\nР/с 2020 0000", logo=logo())
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["has_logo"])
        html = self.html()
        self.assertIn("ООО Ромашка", html)
        self.assertIn("ИНН 123456789", html)
        self.assertIn("data:image/png;base64,", html)

    def test_contract_without_brand_is_unchanged(self):
        give_prime(self.user_a)
        self.assertNotIn('class="brand"', self.html())

    def test_brand_hidden_after_plan_expires_but_kept(self):
        give_prime(self.user_a)
        self.save(company_name="ООО Ромашка")
        give_prime(self.user_a, timezone.localdate() - timedelta(days=1))
        self.assertNotIn("ООО Ромашка", self.html())
        data = self.client.get(URL).json()
        self.assertEqual((data["available"], data["company_name"]), (False, "ООО Ромашка"))
        give_prime(self.user_a)
        self.assertIn("ООО Ромашка", self.html())

    def test_brand_is_private_to_owner(self):
        give_prime(self.user_a)
        self.save(company_name="ООО Ромашка")
        self.login(self.user_b)
        self.assertEqual(self.client.get(URL).json()["company_name"], "")

    def test_logo_validation(self):
        give_prime(self.user_a)
        bad = self.save(logo=SimpleUploadedFile("x.png", b"not an image at all", content_type="image/png"))
        self.assertEqual(bad.status_code, 400)
        big = self.save(logo=logo(data=PNG + b"0" * (1024 * 1024)))
        self.assertEqual(big.status_code, 400)
        self.assertFalse(self.client.get(URL).json()["has_logo"])

    def test_replace_and_remove_logo(self):
        give_prime(self.user_a)
        self.save(logo=logo())
        from leasing.models import ContractBrand
        first = ContractBrand.objects.get(user=self.user_a).logo.name
        self.save(logo=logo("new.png"))
        brand = ContractBrand.objects.get(user=self.user_a)
        self.assertNotEqual(brand.logo.name, first)
        self.assertFalse(brand.logo.storage.exists(first))  # старый файл не копится
        r = self.save(remove_logo="1")
        self.assertFalse(r.json()["has_logo"])

    def test_reset_works_even_on_free(self):
        give_prime(self.user_a)
        self.save(company_name="ООО Ромашка", logo=logo())
        Subscription.objects.filter(user=self.user_a).delete()
        self.user_a.refresh_from_db()
        self.assertEqual(self.client.delete(URL).status_code, 204)
        self.assertEqual(self.client.get(URL).json()["company_name"], "")
