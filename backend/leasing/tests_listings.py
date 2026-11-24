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


class ListingFilterTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.user_a.phone = "+998901112233"
        self.user_a.save()
        self.cheap = self.make_property(name="Дешёвая", is_listed=True, listing_price=2_000_000, rooms=1, area_m2=30,
                                        renovation="cosmetic", furniture="none", amenities=["wifi"])
        self.rich = self.make_property(name="Дорогая", is_listed=True, listing_price=8_000_000, rooms=3, area_m2=90,
                                       renovation="euro", furniture="full", amenities=["wifi", "ac", "tv"],
                                       latitude="41.311100", longitude="69.279700")
        self.client.force_authenticate(None)

    def titles(self, query):
        return sorted(x["title"] for x in self.client.get(f"/api/listings/?{query}").json()["results"])

    def test_new_filters(self):
        self.assertEqual(self.titles("price_min=5000000"), ["Дорогая"])
        self.assertEqual(self.titles("area_max=50"), ["Дешёвая"])
        self.assertEqual(self.titles("area_min=50"), ["Дорогая"])
        self.assertEqual(self.titles("renovation=euro"), ["Дорогая"])
        self.assertEqual(self.titles("furniture=none"), ["Дешёвая"])
        self.assertEqual(self.titles("amenities=wifi,ac"), ["Дорогая"])
        self.assertEqual(self.titles("amenities=wifi"), ["Дешёвая", "Дорогая"])
        self.assertEqual(self.titles("search=дорог"), ["Дорогая"])
        self.assertEqual(self.titles("new_days=7"), ["Дешёвая", "Дорогая"])

    def test_has_photo_and_junk_values_are_ignored(self):
        self.assertEqual(self.titles("has_photo=1"), [])
        self.assertEqual(self.titles("price_max=abc&area_min=x&amenities=hack&kind=zzz"), ["Дешёвая", "Дорогая"])

    def test_coordinates_exposed_and_validated(self):
        item = next(x for x in self.client.get("/api/listings/").json()["results"] if x["title"] == "Дорогая")
        self.assertEqual(item["latitude"], "41.311100")
        self.client.force_authenticate(self.user_a)
        r = self.client.patch(f"/api/properties/{self.cheap.pk}/", {"latitude": "41.3"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.patch(f"/api/properties/{self.cheap.pk}/", {"latitude": "95", "longitude": "10"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_stats(self):
        body = self.client.get("/api/listings/stats/").json()
        self.assertEqual(body, {"count": 2, "owners": 1, "min_price": 2_000_000, "new_week": 2})


class SavedSearchTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.user_a.phone = "+998901112233"
        self.user_a.save()
        self.make_property(name="Старая", is_listed=True, listing_price=3_000_000, rooms=2)
        self.client.force_authenticate(None)

    def create(self, filters):
        r = self.client.post("/api/listings/saved-searches/", {"filters": filters, "language": "ru"}, format="json")
        self.assertEqual(r.status_code, 201)
        return r.json()

    def test_link_notify_only_new_and_unlink(self):
        from unittest import mock

        from reminders import bot_logic
        from .models import SavedSearch
        from .tasks import notify_saved_searches

        body = self.create({"rooms": 2, "evil": "x"})
        self.assertEqual(body["start_command"], f"/start s_{body['token']}")
        search = SavedSearch.objects.get(token=body["token"])
        self.assertEqual(search.filters, {"rooms": "2"})
        self.assertIn("Готово", bot_logic.link(f"s_{body['token']}", 555))
        search.refresh_from_db()
        self.assertEqual(search.chat_id, 555)

        sender = mock.Mock()
        with mock.patch("reminders.channels.get_sender", return_value=sender):
            self.assertEqual(notify_saved_searches(), 0)  # старое объявление уже «виденное»
            self.make_property(name="Новая", is_listed=True, listing_price=3_500_000, rooms=2)
            self.make_property(name="Не по фильтру", is_listed=True, listing_price=3_500_000, rooms=5)
            self.assertEqual(notify_saved_searches(), 1)
            self.assertIn("Новая", sender.send.call_args.args[1])
            self.assertEqual(notify_saved_searches(), 0)  # повторно не шлём

        bot_logic.unlink(555)
        search.refresh_from_db()
        self.assertFalse(search.is_active)

    def test_unknown_token(self):
        from reminders import bot_logic
        self.assertIn("не найден", bot_logic.link("s_deadbeef", 1))
