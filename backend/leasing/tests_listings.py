from datetime import timedelta

from django.utils import timezone

from core.testing import OwnerTestCase


class ListingTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.user_a.phone = "+998901112233"
        self.user_a.save()
        self.listed = self.make_property(name="Свободная", is_listed=True, listing_price=4_000_000, rooms=2,
                                         listing_description="Светлая квартира")
        self.hidden = self.make_property(name="Скрытая")

    def guest(self):
        self.client.force_authenticate(None)

    def test_only_consented_vacant_properties_are_public(self):
        rented = self.make_property(name="Сдана", is_listed=True, listing_price=1)
        today = timezone.localdate()
        self.make_lease(prop=rented, start=today - timedelta(days=10), end=today + timedelta(days=300))
        self.make_property(name="Ремонт", is_listed=True, listing_price=1, is_under_repair=True)
        self.guest()
        r = self.client.get("/api/listings/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual([x["title"] for x in r.json()["results"]], ["Свободная"])
        item = r.json()["results"][0]
        self.assertEqual(item["price"], 4_000_000)
        self.assertNotIn("notes", item)
        self.assertEqual(self.client.get(f"/api/listings/{self.hidden.pk}/").status_code, 404)

    def test_phone_falls_back_to_account_then_uses_ad_phone(self):
        self.guest()
        self.assertEqual(self.client.get(f"/api/listings/{self.listed.pk}/").json()["phone"], "+998901112233")
        self.listed.contact_phone = "+998909998877"
        self.listed.save()
        self.assertEqual(self.client.get(f"/api/listings/{self.listed.pk}/").json()["phone"], "+998909998877")

    def test_has_telegram_flag_is_public(self):
        self.guest()
        self.assertTrue(self.client.get(f"/api/listings/{self.listed.pk}/").json()["has_telegram"])
        self.listed.has_telegram = False
        self.listed.save()
        self.assertFalse(self.client.get(f"/api/listings/{self.listed.pk}/").json()["has_telegram"])

    def test_owner_name_is_public_but_not_email(self):
        self.user_a.first_name, self.user_a.last_name = "Алишер", "Каримов"
        self.user_a.save()
        self.guest()
        body = self.client.get(f"/api/listings/{self.listed.pk}/").json()
        self.assertEqual(body["owner_name"], "Алишер Каримов")
        self.assertNotIn("a@example.com", str(body))

    def test_similar_prefers_same_kind_and_close_price_and_excludes_self(self):
        near = self.make_property(name="Рядом", kind="apartment", is_listed=True, listing_price=4_100_000)
        far = self.make_property(name="Дорогая", kind="apartment", is_listed=True, listing_price=9_000_000)
        house = self.make_property(name="Дом", kind="house", is_listed=True, listing_price=4_000_000)
        self.make_property(name="Скрытая2")
        self.guest()
        r = self.client.get(f"/api/listings/{self.listed.pk}/similar/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual([x["id"] for x in r.json()], [near.pk, far.pk, house.pk])
        self.assertEqual(self.client.get(f"/api/listings/{self.hidden.pk}/similar/").status_code, 404)

    def test_price_filter(self):
        self.guest()
        self.assertEqual(self.client.get("/api/listings/?price_max=3000000").json()["count"], 0)
        self.assertEqual(self.client.get("/api/listings/?price_max=5000000").json()["count"], 1)

    def test_listing_requires_price(self):
        r = self.client.patch(f"/api/properties/{self.hidden.pk}/", {"is_listed": True}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("listing_price", r.json())

    def test_listing_requires_a_phone(self):
        self.user_a.phone = ""
        self.user_a.save()
        body = {"is_listed": True, "listing_price": 1_000_000}
        r = self.client.patch(f"/api/properties/{self.hidden.pk}/", body, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("contact_phone", r.json())
        r = self.client.patch(f"/api/properties/{self.hidden.pk}/", {**body, "contact_phone": "90 123 45 67"},
                              format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["contact_phone"], "+998901234567")

    def test_bad_contact_phone(self):
        r = self.client.patch(f"/api/properties/{self.hidden.pk}/", {"contact_phone": "123"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("contact_phone", r.json())

    def test_apartment_details_saved_and_public(self):
        body = {"floor": 5, "floors_total": 9, "renovation": "euro", "furniture": "full",
                "amenities": ["fridge", "wifi", "wifi"], "is_listed": True, "listing_price": 2_000_000,
                "contact_phone": "90 123 45 67"}
        r = self.client.patch(f"/api/properties/{self.hidden.pk}/", body, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["amenities"], ["fridge", "wifi"])
        public = self.client.get(f"/api/listings/{self.hidden.pk}/").json()
        self.assertEqual((public["floor"], public["floors_total"], public["renovation"], public["furniture"]),
                         (5, 9, "euro", "full"))

    def test_bad_apartment_details(self):
        url = f"/api/properties/{self.hidden.pk}/"
        self.assertEqual(self.client.patch(url, {"floor": 12, "floors_total": 9}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"amenities": ["pool"]}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"renovation": "gold"}, format="json").status_code, 400)

    def test_owner_info_and_filter(self):
        data = self.client.get(f"/api/listings/{self.listed.pk}/").json()
        self.assertEqual(data["owner"], self.user_a.pk)
        self.assertEqual(data["owner_listings"], 1)
        self.assertTrue(data["owner_since"])
        self.assertEqual(self.client.get(f"/api/listings/?owner={self.user_a.pk}").json()["count"], 1)
        self.assertEqual(self.client.get(f"/api/listings/?owner={self.user_b.pk}").json()["count"], 0)
