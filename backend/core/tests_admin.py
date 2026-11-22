from django.core import mail

from users.models import User

from .models import AuditLog
from .testing import OwnerTestCase


class AdminApiTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_superuser("root@example.com", self.password)

    def test_non_admin_forbidden(self):
        for url in ("stats/", "users/", "audit/", "transactions/"):
            self.assertEqual(self.client.get(f"/api/admin/{url}").status_code, 403, url)
        self.assertFalse(self.client.get("/api/me/").json()["is_admin"])

    def test_stats_and_users_list(self):
        self.make_property()
        self.login(self.admin)
        self.assertTrue(self.client.get("/api/me/").json()["is_admin"])
        stats = self.client.get("/api/admin/stats/").json()
        self.assertEqual((stats["landlords"], stats["properties"]), (2, 1))
        rows = self.client.get("/api/admin/users/").json()["results"]
        self.assertEqual({r["email"] for r in rows}, {"a@example.com", "b@example.com"})  # админа в списке нет
        found = self.client.get("/api/admin/users/?search=a@example").json()["results"]
        self.assertEqual([r["email"] for r in found], ["a@example.com"])
        self.assertEqual(found[0]["properties_count"], 1)
        overview = self.client.get(f"/api/admin/users/{self.user_a.pk}/overview/").json()
        self.assertEqual(len(overview["properties"]), 1)

    def test_block_unblock_logged_and_blocks_login(self):
        self.login(self.admin)
        r = self.client.post(f"/api/admin/users/{self.user_a.pk}/block/")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["is_active"])
        self.user_a.refresh_from_db()
        self.assertFalse(self.user_a.is_active)
        log = AuditLog.objects.get(action="admin_block_user")
        self.assertEqual((log.owner, log.actor), (self.user_a, self.admin))
        self.client.post(f"/api/admin/users/{self.user_a.pk}/unblock/")
        self.user_a.refresh_from_db()
        self.assertTrue(self.user_a.is_active)

    def test_cannot_touch_admin_or_self(self):
        self.login(self.admin)
        self.assertEqual(self.client.post(f"/api/admin/users/{self.admin.pk}/block/").status_code, 404)

    def test_reset_password_sends_mail(self):
        self.login(self.admin)
        r = self.client.post(f"/api/admin/users/{self.user_a.pk}/reset-password/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["a@example.com"])
        self.assertTrue(AuditLog.objects.filter(action="admin_reset_password").exists())

    def test_audit_and_transactions_lists(self):
        self.login(self.admin)
        self.client.post(f"/api/admin/users/{self.user_a.pk}/block/")
        audit = self.client.get(f"/api/admin/audit/?owner={self.user_a.pk}").json()["results"]
        self.assertEqual(audit[0]["actor_email"], "root@example.com")
        self.assertEqual(self.client.get("/api/admin/transactions/").status_code, 200)
