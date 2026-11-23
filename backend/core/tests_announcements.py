"""Объявления админа (баннеры в кабинете): создание, проверка данных, видимость и права."""
from rest_framework.test import APIClient

from portal.services import create_tenant_user

from .models import Announcement, AuditLog
from .tests_admin_platform import PlatformBase

ADMIN_URL = "/api/admin/announcements/"
PUBLIC_URL = "/api/announcements/"


class AnnouncementBase(PlatformBase):
    def make(self, text="Плановые работы", **kw):
        return Announcement.objects.create(text_ru=text, **kw)

    def public_ids(self, user):
        self.login(user)
        return [a["id"] for a in self.client.get(PUBLIC_URL).json()]


class AnnouncementCreateTests(AnnouncementBase):
    def test_create_sets_defaults_and_author(self):
        r = self.client.post(ADMIN_URL, {"text_ru": "Завтра работы"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual((body["level"], body["is_active"], body["text_uz"]), ("info", True, ""))
        self.assertEqual(body["created_by_email"], self.admin.email)
        self.assertEqual(Announcement.objects.get(pk=body["id"]).created_by, self.admin)

    def test_blank_and_whitespace_text_rejected(self):
        for text in ("", "   "):
            r = self.client.post(ADMIN_URL, {"text_ru": text}, format="json")
            self.assertEqual(r.status_code, 400, text)
        self.assertFalse(Announcement.objects.exists())

    def test_length_limits_on_both_languages(self):
        self.assertEqual(self.client.post(ADMIN_URL, {"text_ru": "x" * 500}, format="json").status_code, 201)
        self.assertEqual(self.client.post(ADMIN_URL, {"text_ru": "x" * 501}, format="json").status_code, 400)
        r = self.client.post(ADMIN_URL, {"text_ru": "ok", "text_uz": "y" * 501}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("text_uz", r.json())

    def test_unknown_level_rejected(self):
        r = self.client.post(ADMIN_URL, {"text_ru": "x", "level": "critical"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_cannot_forge_author_or_dates(self):
        r = self.client.post(
            ADMIN_URL,
            {"text_ru": "x", "created_by": self.user_a.pk, "created_by_email": "fake@example.com",
             "created_at": "2001-01-01T00:00:00Z"},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        item = Announcement.objects.get(pk=r.json()["id"])
        self.assertEqual(item.created_by, self.admin)
        self.assertGreater(item.created_at.year, 2020)

    def test_create_is_written_to_audit_log(self):
        r = self.client.post(ADMIN_URL, {"text_ru": "x"}, format="json")
        entry = AuditLog.objects.get(action="admin_announcement_create")
        self.assertEqual((entry.actor, entry.object_id), (self.admin, r.json()["id"]))


class AnnouncementVisibilityTests(AnnouncementBase):
    def test_public_list_shows_only_active_oldest_first(self):
        first = self.make("Первое")
        self.make("Выключено", is_active=False)
        third = self.make("Третье", level="warning")
        self.assertEqual(self.public_ids(self.user_a), [first.pk, third.pk])

    def test_public_payload_has_no_internal_fields(self):
        self.make("Текст", text_uz="Matn")
        self.login(self.user_a)
        item = self.client.get(PUBLIC_URL).json()[0]
        self.assertEqual(set(item), {"id", "text_ru", "text_uz", "level"})

    def test_tenant_sees_announcements_too(self):
        item = self.make("Для всех")
        tenant_user = create_tenant_user(email="t@example.com", password=self.password)
        self.assertEqual(self.public_ids(tenant_user), [item.pk])

    def test_anonymous_gets_401(self):
        self.make()
        self.assertEqual(APIClient().get(PUBLIC_URL).status_code, 401)
        self.assertEqual(APIClient().get(ADMIN_URL).status_code, 401)

    def test_admin_list_includes_inactive(self):
        active, hidden = self.make("A"), self.make("B", is_active=False)
        r = self.client.get(ADMIN_URL)
        self.assertEqual(r.status_code, 200)
        ids = {a["id"] for a in r.json()["results"]}
        self.assertEqual(ids, {active.pk, hidden.pk})


class AnnouncementUpdateDeleteTests(AnnouncementBase):
    def test_toggle_active_hides_and_shows_banner(self):
        item = self.make()
        url = f"{ADMIN_URL}{item.pk}/"
        self.assertEqual(self.client.patch(url, {"is_active": False}, format="json").status_code, 200)
        self.assertEqual(self.public_ids(self.user_a), [])
        self.login(self.admin)
        self.client.patch(url, {"is_active": True}, format="json")
        self.assertEqual(self.public_ids(self.user_a), [item.pk])

    def test_update_logged_with_active_flag(self):
        item = self.make()
        self.client.patch(f"{ADMIN_URL}{item.pk}/", {"is_active": False, "text_ru": "Новое"}, format="json")
        entry = AuditLog.objects.get(action="admin_announcement_update")
        self.assertEqual(entry.details.get("active"), False)
        item.refresh_from_db()
        self.assertEqual(item.text_ru, "Новое")

    def test_delete_removes_and_logs(self):
        item = self.make()
        self.assertEqual(self.client.delete(f"{ADMIN_URL}{item.pk}/").status_code, 204)
        self.assertFalse(Announcement.objects.filter(pk=item.pk).exists())
        self.assertTrue(AuditLog.objects.filter(action="admin_announcement_delete").exists())
        self.assertEqual(self.client.delete(f"{ADMIN_URL}{item.pk}/").status_code, 404)

    def test_deleting_author_keeps_announcement(self):
        other_admin = type(self.admin).objects.create_superuser("second@example.com", self.password)
        item = self.make(created_by=other_admin)
        other_admin.delete()
        item.refresh_from_db()
        self.assertIsNone(item.created_by)
        self.assertIsNone(self.client.get(f"{ADMIN_URL}{item.pk}/").json()["created_by_email"])


class AnnouncementPermissionTests(AnnouncementBase):
    def test_landlord_cannot_manage(self):
        item = self.make()
        self.login(self.user_a)
        self.assertEqual(self.client.get(ADMIN_URL).status_code, 403)
        self.assertEqual(self.client.post(ADMIN_URL, {"text_ru": "x"}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(f"{ADMIN_URL}{item.pk}/", {"text_ru": "взлом"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"{ADMIN_URL}{item.pk}/").status_code, 403)
        item.refresh_from_db()
        self.assertEqual(item.text_ru, "Плановые работы")

    def test_tenant_cannot_manage(self):
        tenant_user = create_tenant_user(email="t2@example.com", password=self.password)
        self.login(tenant_user)
        self.assertEqual(self.client.post(ADMIN_URL, {"text_ru": "x"}, format="json").status_code, 403)

    def test_support_can_read_but_not_change(self):
        item = self.make()
        self.login(self.support)
        self.assertEqual(self.client.get(ADMIN_URL).status_code, 200)
        self.assertEqual(self.client.post(ADMIN_URL, {"text_ru": "x"}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(f"{ADMIN_URL}{item.pk}/", {"is_active": False}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"{ADMIN_URL}{item.pk}/").status_code, 403)
        self.assertTrue(Announcement.objects.filter(pk=item.pk, is_active=True).exists())

    def test_impersonation_token_cannot_create(self):
        """Админ, «вошедший как арендодатель», получает права арендодателя, а не админа."""
        token = self.client.post(f"/api/admin/users/{self.user_a.pk}/impersonate/").json()["access"]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(client.post(ADMIN_URL, {"text_ru": "x"}, format="json").status_code, 403)
        self.assertEqual(client.get(PUBLIC_URL).status_code, 200)
