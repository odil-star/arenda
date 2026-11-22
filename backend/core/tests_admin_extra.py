from datetime import timedelta
from unittest import mock

from django.core import mail
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from leasing.models import PaymentTransaction
from users.models import User

from .models import AuditLog
from .testing import OwnerTestCase


class FakeTelegramSender:
    sent: list = []

    def send(self, chat_id, text):
        FakeTelegramSender.sent.append((chat_id, text))


@override_settings(TELEGRAM_SENDER="core.tests_admin_extra.FakeTelegramSender")
class AdminExtraApiTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_superuser("root@example.com", self.password)
        FakeTelegramSender.sent = []
        self.login(self.admin)

    def _tx(self, payment, ext, state, provider="payme", old=False):
        tx = PaymentTransaction.objects.create(
            owner=payment.owner, payment=payment, provider=provider, external_id=ext, amount=1000, state=state,
            performed_at=timezone.now() if state == 2 else None,
        )
        if old:
            PaymentTransaction.objects.filter(pk=tx.pk).update(created_at=timezone.now() - timedelta(days=3))
        return tx

    # --- выгрузка
    def test_export_csv_with_bom_and_formula_protection(self):
        User.objects.filter(pk=self.user_a.pk).update(first_name="=HYPERLINK(1)")
        r = self.client.get("/api/admin/users/export/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/csv", r["Content-Type"])
        text = r.content.decode("utf-8")
        self.assertTrue(text.startswith("﻿Email;"))
        self.assertIn("a@example.com", text)
        self.assertIn("'=HYPERLINK(1)", text)  # формула обезврежена
        found = self.client.get("/api/admin/users/export/?search=b@example").content.decode("utf-8")
        self.assertNotIn("a@example.com", found)

    def test_export_requires_admin(self):
        self.login(self.user_a)
        self.assertEqual(self.client.get("/api/admin/users/export/").status_code, 403)

    # --- журнал
    def test_audit_filters(self):
        self.client.post(f"/api/admin/users/{self.user_a.pk}/block/")
        actions = self.client.get("/api/admin/audit/actions/").json()
        self.assertIn("admin_block_user", actions)
        today = timezone.localdate().isoformat()
        hit = self.client.get(f"/api/admin/audit/?action=admin_block_user&date_from={today}&date_to={today}").json()
        self.assertEqual(hit["count"], 1)
        old = self.client.get("/api/admin/audit/?date_to=2000-01-01").json()
        self.assertEqual(old["count"], 0)
        self.assertEqual(self.client.get("/api/admin/audit/?date_from=oops").status_code, 200)

    # --- график и проблемные платежи
    def test_daily_stats_series(self):
        series = self.client.get("/api/admin/stats/daily/?days=30").json()
        self.assertEqual(len(series), 30)
        self.assertEqual(series[-1]["date"], timezone.localdate().isoformat())
        self.assertEqual(series[-1]["new_landlords"], 2)  # a и b созданы сегодня, админ не считается
        self.assertEqual(len(self.client.get("/api/admin/stats/daily/?days=1").json()), 7)  # нижняя граница

    def test_problem_transactions(self):
        lease = self.make_lease()
        pay = lease.payments.first()
        self._tx(pay, "ok", 2)
        self._tx(pay, "cancelled", -1)
        self._tx(pay, "refunded", -2)
        self._tx(pay, "stuck", 1, old=True)
        self._tx(pay, "fresh", 1)  # создана только что — ещё не «зависла»
        ids = {r["external_id"] for r in self.client.get("/api/admin/transactions/?problem=1").json()["results"]}
        self.assertEqual(ids, {"cancelled", "refunded", "stuck"})
        self.assertEqual(self.client.get("/api/admin/stats/").json()["problem_payments"], 3)

    # --- жильцы и договоры
    def test_tenants_and_leases_lists(self):
        self.make_lease()
        tenants = self.client.get("/api/admin/tenants/?search=Иванов").json()["results"]
        self.assertEqual((len(tenants), tenants[0]["owner_email"], tenants[0]["leases_count"]), (1, "a@example.com", 1))
        leases = self.client.get("/api/admin/leases/").json()["results"]
        self.assertEqual((len(leases), leases[0]["tenant_name"]), (1, "Иванов Иван"))
        self.assertEqual(self.client.get("/api/admin/leases/?status=ended").json()["count"], 0)
        self.assertEqual(self.client.get("/api/admin/leases/export/").status_code, 200)
        self.login(self.user_a)
        self.assertEqual(self.client.get("/api/admin/tenants/").status_code, 403)

    # --- рассылки
    def test_message_to_all_by_email_and_telegram(self):
        User.objects.filter(pk=self.user_a.pk).update(telegram_chat_id=777)
        r = self.client.post("/api/admin/messages/", {
            "subject": "Плановые работы", "body": "Завтра с 2:00 до 3:00", "audience": "all",
            "channels": ["email", "telegram"],
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        data = r.json()
        self.assertEqual(
            (data["recipients_count"], data["email_sent"], data["telegram_sent"], data["failed"]), (2, 2, 1, 0)
        )
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ["a@example.com", "b@example.com"])  # админа нет
        self.assertEqual(FakeTelegramSender.sent[0][0], 777)
        self.assertEqual(AuditLog.objects.filter(action="admin_message").count(), 2)
        self.assertEqual(self.client.get("/api/admin/messages/").json()["results"][0]["subject"], "Плановые работы")

    def test_duplicate_message_rejected(self):
        body = {"subject": "Дубль", "body": "Текст", "audience": "all", "channels": ["email"]}
        self.assertEqual(self.client.post("/api/admin/messages/", body, format="json").status_code, 201)
        again = self.client.post("/api/admin/messages/", body, format="json")
        self.assertEqual(again.status_code, 400)  # повторный клик не рассылает второй раз
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(self.client.post("/api/admin/messages/", {**body, "body": "Другой"}, format="json").status_code, 201)

    def test_telegram_network_down_stops_after_first_failure(self):
        from reminders.channels import SendError

        calls = []

        class DownSender:
            def send(self, chat_id, text):
                calls.append(chat_id)
                raise SendError("Нет связи с Telegram: URLError")

        User.objects.filter(pk=self.user_a.pk).update(telegram_chat_id=1)
        User.objects.filter(pk=self.user_b.pk).update(telegram_chat_id=2)
        with mock.patch("core.admin_extra.get_sender", return_value=DownSender()):
            r = self.client.post("/api/admin/messages/", {
                "subject": "S", "body": "B", "audience": "all", "channels": ["telegram"],
            }, format="json")
        self.assertEqual((r.json()["telegram_sent"], r.json()["failed"]), (0, 2))
        self.assertEqual(len(calls), 1)  # второму не пытались — сеть лежит

    def test_message_selected_and_blocked_skipped(self):
        User.objects.filter(pk=self.user_b.pk).update(is_active=False)
        r = self.client.post("/api/admin/messages/", {
            "subject": "S", "body": "B", "audience": "selected", "user_ids": [self.user_a.pk, self.user_b.pk],
            "channels": ["email"],
        }, format="json")
        self.assertEqual(r.json()["recipients_count"], 1)  # заблокированному не пишем
        self.assertEqual([m.to for m in mail.outbox], [["a@example.com"]])

    def test_message_validation_and_unreachable(self):
        base = {"subject": "S", "body": "B"}
        for bad in (
            {**base, "audience": "selected", "user_ids": [], "channels": ["email"]},
            {**base, "audience": "all", "channels": []},
            {**base, "audience": "all", "channels": ["sms"]},
        ):
            self.assertEqual(self.client.post("/api/admin/messages/", bad, format="json").status_code, 400, bad)
        # Telegram выбран, но ни у кого не привязан — доставки нет
        r = self.client.post("/api/admin/messages/", {**base, "audience": "all", "channels": ["telegram"]}, format="json")
        self.assertEqual((r.json()["telegram_sent"], r.json()["failed"]), (0, 2))
        self.login(self.user_a)
        denied = self.client.post("/api/admin/messages/", {**base, "audience": "all", "channels": ["email"]}, format="json")
        self.assertEqual(denied.status_code, 403)

    # --- администраторы
    def test_admins_create_list_revoke(self):
        r = self.client.post(
            "/api/admin/admins/", {"email": "Boss@Example.com", "password": "Str0ng-pass-987"}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.content)
        new = User.objects.get(email="boss@example.com")
        self.assertTrue(new.is_superuser and new.is_staff)
        self.assertTrue(AuditLog.objects.filter(action="admin_grant", owner=new, actor=self.admin).exists())
        emails = {a["email"] for a in self.client.get("/api/admin/admins/").json()}
        self.assertEqual(emails, {"root@example.com", "boss@example.com"})
        self.assertEqual(self.client.delete(f"/api/admin/admins/{new.pk}/").status_code, 204)
        new.refresh_from_db()
        self.assertFalse(new.is_superuser or new.is_staff)
        self.assertTrue(AuditLog.objects.filter(action="admin_revoke", owner=new).exists())

    def test_admins_validation_and_guards(self):
        url = "/api/admin/admins/"
        weak = self.client.post(url, {"email": "x@example.com", "password": "123"}, format="json")
        self.assertEqual(weak.status_code, 400)
        taken = self.client.post(url, {"email": "a@example.com", "password": "Str0ng-pass-987"}, format="json")
        self.assertEqual(taken.status_code, 400)
        self.assertEqual(self.client.delete(f"{url}{self.admin.pk}/").status_code, 400)  # себя нельзя
        other = User.objects.create_superuser("second@example.com", self.password)
        self.login(other)
        self.assertEqual(self.client.delete(f"{url}{self.admin.pk}/").status_code, 204)  # второй снял первого
        self.assertEqual(self.client.delete(f"{url}{other.pk}/").status_code, 400)  # а себя (последнего) — нельзя
        self.login(self.user_a)
        self.assertEqual(self.client.get(url).status_code, 403)

    # --- просмотр от имени арендодателя
    def test_impersonation_is_read_only_and_logged(self):
        self.make_property()
        r = self.client.post(f"/api/admin/users/{self.user_a.pk}/impersonate/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(
            AuditLog.objects.filter(action="admin_impersonate", owner=self.user_a, actor=self.admin).exists()
        )

        viewer = APIClient()
        viewer.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
        me = viewer.get("/api/me/")
        self.assertEqual((me.status_code, me.json()["email"], me.json()["is_admin"]), (200, "a@example.com", False))
        self.assertEqual(viewer.get("/api/properties/").json()["count"], 1)  # данные арендодателя видны
        for method, url in (("post", "/api/properties/"), ("patch", "/api/me/"), ("delete", "/api/properties/1/")):
            self.assertEqual(getattr(viewer, method)(url, {}, format="json").status_code, 403, url)
        self.assertEqual(viewer.get("/api/admin/stats/").status_code, 403)  # админских прав токен не даёт

    def test_impersonate_blocked_user_refused(self):
        User.objects.filter(pk=self.user_a.pk).update(is_active=False)
        self.assertEqual(self.client.post(f"/api/admin/users/{self.user_a.pk}/impersonate/").status_code, 400)
        self.login(self.user_b)
        self.assertEqual(self.client.post(f"/api/admin/users/{self.user_a.pk}/impersonate/").status_code, 403)
