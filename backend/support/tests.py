from unittest import mock

from django.core.cache import cache
from django.test import override_settings

from core.testing import OwnerTestCase
from users.models import User, UserProfile

from .models import SupportMessage, SupportThread
from .tasks import notify_support_reply


class SupportBase(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_superuser("root@example.com", self.password)
        self.support = User.objects.create_user("help@example.com", self.password, is_staff=True)
        self.resident = User.objects.create_user("t@example.com", self.password)
        UserProfile.objects.filter(user=self.resident).update(role="tenant")
        self.resident.refresh_from_db()

    def send(self, user, body="Здравствуйте"):
        self.login(user)
        return self.client.post("/api/support/messages/", {"body": body}, format="json")

    def thread(self, user):
        return SupportThread.objects.get(user=user)


class UserChatTests(SupportBase):
    def test_empty_before_first_message(self):
        data = self.client.get("/api/support/messages/").json()
        self.assertEqual(data, {"results": [], "has_more": False, "status": None, "unread": 0, "staff_online": False})
        self.assertFalse(SupportThread.objects.exists())

    def test_landlord_and_tenant_can_write(self):
        for user in (self.user_a, self.resident):
            r = self.send(user, "Помогите")
            self.assertEqual(r.status_code, 201, r.content)
            self.assertFalse(r.json()["from_staff"])
            msgs = self.client.get("/api/support/messages/").json()["results"]
            self.assertEqual([m["body"] for m in msgs], ["Помогите"])

    def test_users_see_only_own_thread(self):
        self.send(self.user_a, "мой вопрос")
        self.send(self.user_b, "чужой вопрос")
        self.login(self.user_a)
        bodies = [m["body"] for m in self.client.get("/api/support/messages/").json()["results"]]
        self.assertEqual(bodies, ["мой вопрос"])

    def test_staff_cannot_use_user_endpoint(self):
        for user in (self.admin, self.support):
            self.assertEqual(self.send(user).status_code, 403)

    def test_validation(self):
        self.assertEqual(self.send(self.user_a, "   ").status_code, 400)
        self.assertEqual(self.send(self.user_a, "x" * 2001).status_code, 400)
        self.assertFalse(SupportThread.objects.exists())
        self.send(self.user_a)
        self.assertEqual(self.client.get("/api/support/messages/?after=abc").status_code, 400)

    def test_rate_limit(self):
        cache.clear()
        for _ in range(20):
            self.assertEqual(self.send(self.user_a).status_code, 201)
        self.assertEqual(self.send(self.user_a).status_code, 429)

    def test_user_message_reopens_closed_thread(self):
        self.send(self.user_a)
        SupportThread.objects.update(status="closed")
        self.send(self.user_a)
        self.assertEqual(self.thread(self.user_a).status, "open")

    def test_pagination_cursors(self):
        thread = SupportThread.objects.create(user=self.user_a)
        ids = [SupportMessage.objects.create(thread=thread, author=self.user_a, body=str(i)).id for i in range(55)]
        first = self.client.get("/api/support/messages/").json()
        self.assertEqual(len(first["results"]), 50)
        self.assertTrue(first["has_more"])
        self.assertEqual(first["results"][-1]["id"], ids[-1])
        older = self.client.get(f"/api/support/messages/?before={first['results'][0]['id']}").json()
        self.assertEqual([m["id"] for m in older["results"]], ids[:5])
        self.assertFalse(older["has_more"])
        newer = self.client.get(f"/api/support/messages/?after={ids[-3]}").json()
        self.assertEqual([m["id"] for m in newer["results"]], ids[-2:])


class AdminChatTests(SupportBase):
    def test_full_conversation(self):
        self.send(self.user_a, "Не вижу платежи")
        thread = self.thread(self.user_a)

        self.login(self.support)
        self.assertEqual(self.client.get("/api/admin/support/threads/unread/").json(), {"threads": 1})
        row = self.client.get("/api/admin/support/threads/").json()["results"][0]
        self.assertEqual((row["user_email"], row["unread"], row["last_body"]), ("a@example.com", 1, "Не вижу платежи"))

        # «поддержка» может отвечать, читать и закрывать
        r = self.client.post(f"/api/admin/support/threads/{thread.id}/reply/", {"body": "Сейчас проверим"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["author_name"], "help@example.com")
        self.assertEqual(self.client.post(f"/api/admin/support/threads/{thread.id}/read/").status_code, 200)
        self.assertEqual(self.client.get("/api/admin/support/threads/unread/").json(), {"threads": 0})

        # пользователь видит ответ как непрочитанный, но без имени сотрудника
        self.login(self.user_a)
        self.assertEqual(self.client.get("/api/support/unread/").json(), {"unread": 1})
        msgs = self.client.get("/api/support/messages/").json()["results"]
        self.assertEqual((msgs[-1]["from_staff"], msgs[-1]["author_name"]), (True, None))
        self.client.post("/api/support/read/")
        self.assertEqual(self.client.get("/api/support/unread/").json(), {"unread": 0})

        self.login(self.support)
        r = self.client.post(f"/api/admin/support/threads/{thread.id}/close/")
        self.assertEqual(r.json()["status"], "closed")
        closed = self.client.get("/api/admin/support/threads/?status=closed").json()["results"]
        self.assertEqual([t["id"] for t in closed], [thread.id])
        self.assertEqual(self.client.post(f"/api/admin/support/threads/{thread.id}/reopen/").json()["status"], "open")

    def test_non_staff_has_no_admin_access(self):
        self.send(self.user_a)
        thread = self.thread(self.user_a)
        self.login(self.user_b)
        self.assertEqual(self.client.get("/api/admin/support/threads/").status_code, 403)
        r = self.client.post(f"/api/admin/support/threads/{thread.id}/reply/", {"body": "x"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_search_and_unread_filter(self):
        self.send(self.user_a, "1")
        self.send(self.resident, "2")
        self.login(self.admin)
        rows = self.client.get("/api/admin/support/threads/?search=t@example").json()["results"]
        self.assertEqual([(r["user_email"], r["user_role"]) for r in rows], [("t@example.com", "tenant")])
        thread = self.thread(self.user_a)
        self.client.post(f"/api/admin/support/threads/{thread.id}/read/")
        rows = self.client.get("/api/admin/support/threads/?unread=true").json()["results"]
        self.assertEqual([r["user_email"] for r in rows], ["t@example.com"])

    @override_settings(TELEGRAM_SENDER="reminders.channels.TelegramSender")
    def test_reply_notifies_telegram(self):
        self.user_a.telegram_chat_id = 555
        self.user_a.save()
        self.send(self.user_a)
        thread = self.thread(self.user_a)
        self.login(self.admin)
        with mock.patch("support.tasks.get_sender") as sender, self.captureOnCommitCallbacks(execute=True):
            self.client.post(f"/api/admin/support/threads/{thread.id}/reply/", {"body": "Готово"}, format="json")
        sender.return_value.send.assert_called_once()
        chat_id, text = sender.return_value.send.call_args.args
        self.assertEqual(chat_id, 555)
        self.assertIn("Готово", text)

    def test_notify_skips_unlinked_user(self):
        self.send(self.user_a)
        message = SupportMessage.objects.create(thread=self.thread(self.user_a), author=self.admin, from_staff=True, body="x")
        self.assertFalse(notify_support_reply(message.id))


class AdminStatsTests(SupportBase):
    def test_counts_to_answer_and_closed_today_reset_at_midnight(self):
        from datetime import timedelta

        from django.utils import timezone

        self.send(self.resident, "Нужна помощь")
        self.send(self.user_a, "И мне")
        self.login(self.admin)
        data = self.client.get("/api/admin/support/threads/stats/").json()
        self.assertEqual((data["to_answer"], data["closed_today"]), (2, 0))

        tid = self.thread(self.resident).pk
        self.client.post(f"/api/admin/support/threads/{tid}/reply/", {"body": "Ок"}, format="json")
        self.client.post(f"/api/admin/support/threads/{tid}/close/")
        data = self.client.get("/api/admin/support/threads/stats/").json()
        self.assertEqual((data["to_answer"], data["closed_today"]), (1, 1))

        # закрыто «вчера» — в сегодняшний счётчик не попадает
        SupportThread.objects.filter(pk=tid).update(closed_at=timezone.now() - timedelta(days=1, hours=1))
        data = self.client.get("/api/admin/support/threads/stats/").json()
        self.assertEqual(data["closed_today"], 0)
