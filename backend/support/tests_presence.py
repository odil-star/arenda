from datetime import timedelta

from django.utils import timezone

from core.testing import OwnerTestCase
from users.models import User

from .models import StaffPresence

URL = "/api/admin/support/presence/"


class PresenceTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_superuser("root@example.com", self.password)
        self.helper = User.objects.create_user("help@example.com", self.password, is_staff=True)

    def user_sees_online(self):
        self.login(self.user_a)
        return self.client.get("/api/support/messages/").json()["staff_online"]

    def test_default_offline_and_toggle(self):
        self.login(self.admin)
        data = self.client.get(URL).json()
        self.assertEqual((data["status"], data["online"], data["anyone_online"]), ("offline", False, False))
        self.assertFalse(self.user_sees_online())

        self.login(self.admin)
        data = self.client.post(URL, {"status": "online"}, format="json").json()
        self.assertEqual((data["status"], data["online"]), ("online", True))
        self.assertTrue(self.user_sees_online())

        self.login(self.admin)
        self.client.post(URL, {"status": "offline"}, format="json")
        self.assertFalse(self.user_sees_online())

    def test_support_role_can_set_own_status(self):
        self.login(self.helper)
        r = self.client.post(URL, {"status": "online"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(StaffPresence.objects.get(user=self.helper).status, "online")

    def test_forgotten_online_expires_without_heartbeat(self):
        self.login(self.admin)
        self.client.post(URL, {"status": "online"}, format="json")
        StaffPresence.objects.filter(user=self.admin).update(last_seen=timezone.now() - timedelta(minutes=11))
        self.assertFalse(self.user_sees_online())  # админка закрыта больше 10 минут
        self.login(self.admin)
        self.assertTrue(self.client.get(URL).json()["online"])  # открыл админку — снова в сети
        self.assertTrue(self.user_sees_online())

    def test_blocked_staff_not_counted(self):
        self.login(self.admin)
        self.client.post(URL, {"status": "online"}, format="json")
        User.objects.filter(pk=self.admin.pk).update(is_active=False)
        self.assertFalse(self.user_sees_online())

    def test_validation_and_access(self):
        self.login(self.admin)
        self.assertEqual(self.client.post(URL, {"status": "busy"}, format="json").status_code, 400)
        self.login(self.user_a)
        self.assertEqual(self.client.get(URL).status_code, 403)
        self.assertEqual(self.client.post(URL, {"status": "online"}, format="json").status_code, 403)

    def test_user_payload_has_no_staff_names(self):
        self.login(self.admin)
        self.client.post(URL, {"status": "online"}, format="json")
        self.login(self.user_a)
        data = self.client.get("/api/support/messages/").json()
        self.assertNotIn("root@example.com", str(data))
