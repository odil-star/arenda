import base64
from datetime import timedelta
from unittest import mock

from django.core import mail
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from leasing.models import PaymentTransaction, Property
from users.models import User

from .models import AdminNote, AuditLog, Plan, Subscription, WebhookLog
from .tasks import check_problem_payments, prune_webhook_logs
from .testing import OwnerTestCase


def payme_auth(key="k"):
    return "Basic " + base64.b64encode(f"Paycom:{key}".encode()).decode()


class PlatformBase(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_superuser("root@example.com", self.password)
        self.support = User.objects.create_user("help@example.com", self.password, is_staff=True)
        self.login(self.admin)

    def _tx(self, payment, ext, state, **kw):
        return PaymentTransaction.objects.create(
            owner=payment.owner, payment=payment, provider="payme", external_id=ext, amount=1000, state=state, **kw
        )


class SupportRoleTests(PlatformBase):
    def test_me_exposes_role(self):
        self.login(self.support)
        me = self.client.get("/api/me/").json()
        self.assertEqual((me["is_admin"], me["admin_role"]), (True, "support"))
        self.login(self.admin)
        self.assertEqual(self.client.get("/api/me/").json()["admin_role"], "admin")
        self.login(self.user_a)
        me = self.client.get("/api/me/").json()
        self.assertEqual((me["is_admin"], me["admin_role"]), (False, None))

    def test_support_can_read_but_not_change(self):
        self.login(self.support)
        for url in ("stats/", "users/", "audit/", "transactions/", "tenants/", "leases/", "system/", "webhooks/", "plans/"):
            self.assertEqual(self.client.get(f"/api/admin/{url}").status_code, 200, url)
        pk = self.user_a.pk
        for url in ("block/", "unblock/", "reset-password/"):
            self.assertEqual(self.client.post(f"/api/admin/users/{pk}/{url}").status_code, 403, url)
        self.assertEqual(self.client.post(f"/api/admin/users/{pk}/subscription/", {"plan": None}, format="json").status_code, 403)
        self.assertEqual(self.client.post("/api/admin/plans/", {"name": "X"}, format="json").status_code, 403)
        self.assertEqual(self.client.post("/api/admin/announcements/", {"text_ru": "x"}, format="json").status_code, 403)
        # рассылки и управление сотрудниками — только полный админ
        self.assertEqual(self.client.get("/api/admin/messages/").status_code, 403)
        self.assertEqual(self.client.get("/api/admin/admins/").status_code, 403)
        self.user_a.refresh_from_db()
        self.assertTrue(self.user_a.is_active)

    def test_support_cannot_impersonate_or_export(self):
        """ПДн и вход «как арендодатель» — только полному администратору."""
        self.login(self.support)
        r = self.client.post(f"/api/admin/users/{self.user_a.pk}/impersonate/")
        self.assertEqual(r.status_code, 403)
        self.assertFalse(AuditLog.objects.filter(action="admin_impersonate").exists())
        for resource in ("users", "tenants", "leases", "audit", "transactions"):
            self.assertEqual(self.client.get(f"/api/admin/{resource}/export/").status_code, 403, resource)
        self.assertEqual(self.client.get("/api/admin/users/").status_code, 200)  # просмотр остаётся

    def test_superuser_impersonation_is_logged(self):
        r = self.client.post(f"/api/admin/users/{self.user_a.pk}/impersonate/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action="admin_impersonate", actor=self.admin).exists())

    def test_sensitive_actions_are_throttled(self):
        from django.core.cache import cache
        from rest_framework.settings import api_settings
        cache.clear()
        rates = dict(api_settings.DEFAULT_THROTTLE_RATES)
        from unittest import mock
        from rest_framework.throttling import ScopedRateThrottle
        with mock.patch.object(ScopedRateThrottle, "THROTTLE_RATES", {**rates, "admin_sensitive": "2/hour"}):
            codes = [self.client.get("/api/admin/users/export/").status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])

    def test_support_not_listed_as_landlord(self):
        emails = {u["email"] for u in self.client.get("/api/admin/users/").json()["results"]}
        self.assertNotIn("help@example.com", emails)
        self.assertEqual(self.client.get("/api/admin/stats/").json()["landlords"], 2)

    def test_create_and_revoke_support(self):
        r = self.client.post(
            "/api/admin/admins/", {"email": "new@example.com", "password": "Str0ng-pass-987", "role": "support"}, format="json"
        )
        self.assertEqual((r.status_code, r.json()["role"]), (201, "support"))
        new = User.objects.get(email="new@example.com")
        self.assertTrue(new.is_staff and not new.is_superuser)
        roles = {a["email"]: a["role"] for a in self.client.get("/api/admin/admins/").json()}
        self.assertEqual(roles["help@example.com"], "support")
        self.assertEqual(self.client.delete(f"/api/admin/admins/{new.pk}/").status_code, 204)
        new.refresh_from_db()
        self.assertFalse(new.is_staff)

    def test_notes_by_support(self):
        r = self.client.post("/api/admin/notes/", {"user": self.user_a.pk, "text": "  звонил  "}, format="json")
        admin_note = r.json()["id"]
        self.login(self.support)
        mine = self.client.post("/api/admin/notes/", {"user": self.user_a.pk, "text": "моя"}, format="json")
        self.assertEqual((mine.status_code, mine.json()["author_email"]), (201, "help@example.com"))
        self.assertEqual(self.client.delete(f"/api/admin/notes/{admin_note}/").status_code, 403)  # чужая
        self.assertEqual(self.client.delete(f"/api/admin/notes/{mine.json()['id']}/").status_code, 204)
        self.login(self.admin)
        self.assertEqual(self.client.delete(f"/api/admin/notes/{admin_note}/").status_code, 204)  # админ может любую


class NotesAndOverviewTests(PlatformBase):
    def test_overview_has_activity_payments_notes(self):
        lease = self.make_lease()
        tx = self._tx(lease.payments.first(), "p1", 2, performed_at=timezone.now())
        AdminNote.objects.create(user=self.user_a, author=self.admin, text="заметка")
        data = self.client.get(f"/api/admin/users/{self.user_a.pk}/overview/").json()
        self.assertEqual([p["id"] for p in data["recent_payments"]], [tx.pk])
        self.assertEqual(data["notes"][0]["text"], "заметка")
        self.assertTrue(data["notes"][0]["can_delete"])
        self.assertIsInstance(data["activity"], list)
        self.assertTrue(data["activity"])  # создание договора попало в журнал

    def test_note_validation_and_only_landlords(self):
        self.assertEqual(self.client.post("/api/admin/notes/", {"user": self.user_a.pk, "text": "  "}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/admin/notes/", {"user": self.admin.pk, "text": "x"}, format="json").status_code, 400)
        n = AdminNote.objects.create(user=self.user_a, author=self.admin, text="a")
        AdminNote.objects.create(user=self.user_b, author=self.admin, text="b")
        rows = self.client.get(f"/api/admin/notes/?user={self.user_a.pk}").json()["results"]
        self.assertEqual([r["id"] for r in rows], [n.pk])


@override_settings(PAYME_KEY="k", PAYME_MERCHANT_ID="m", CLICK_SECRET_KEY="s", CLICK_SERVICE_ID="1")
class WebhookLogTests(PlatformBase):
    def test_payme_logged_with_method_and_payment(self):
        anon = APIClient()
        body = {
            "id": 1, "method": "CheckPerformTransaction",
            "params": {"amount": 100000, "account": {"payment_id": 999999}},
        }
        r = anon.post("/api/webhooks/payme/", body, format="json", HTTP_AUTHORIZATION=payme_auth())
        self.assertEqual(r.status_code, 200)
        log = WebhookLog.objects.get()
        self.assertEqual((log.provider, log.method, log.ok, log.payment_id), ("payme", "CheckPerformTransaction", False, 999999))
        self.assertEqual(log.error_code, "-31050")
        rows = self.client.get("/api/admin/webhooks/?provider=payme&ok=false").json()["results"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(self.client.get("/api/admin/webhooks/?payment=999999").json()["count"], 1)
        self.assertEqual(self.client.get("/api/admin/webhooks/?payment=1").json()["count"], 0)

    def test_payme_bad_auth_logged_and_no_secret_stored(self):
        APIClient().post(
            "/api/webhooks/payme/", {"id": 2, "method": "GetStatement", "params": {"from": 1, "to": 2}},
            format="json", HTTP_AUTHORIZATION=payme_auth("wrong"),
        )
        log = WebhookLog.objects.get()
        self.assertEqual((log.ok, log.error_code), (False, "-32504"))
        self.assertNotIn("wrong", str(log.request) + str(log.response))

    def test_click_form_logged_with_signature_masked(self):
        r = APIClient().post("/api/webhooks/click/", {
            "click_trans_id": "77", "merchant_trans_id": "5", "service_id": "1", "action": "0",
            "amount": "1000", "sign_time": "t", "sign_string": "deadbeef", "click_paydoc_id": "9",
        })
        self.assertEqual(r.status_code, 200)
        log = WebhookLog.objects.get()
        self.assertEqual((log.provider, log.method, log.ok), ("click", "prepare", False))
        self.assertEqual(log.request["sign_string"], "***")
        self.assertEqual(log.request["merchant_trans_id"], "5")  # строка, а не список из QueryDict
        self.assertNotIn("deadbeef", str(log.request))

    def test_logging_failure_does_not_break_webhook(self):
        with mock.patch.object(WebhookLog.objects, "create", side_effect=RuntimeError("db down")):
            r = APIClient().post(
                "/api/webhooks/payme/", {"id": 3, "method": "Nope", "params": {}}, format="json",
                HTTP_AUTHORIZATION=payme_auth(),
            )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["error"]["code"], -32601)

    def test_prune_old_logs(self):
        old = WebhookLog.objects.create(provider="payme")
        WebhookLog.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=90))
        WebhookLog.objects.create(provider="click")
        self.assertEqual(prune_webhook_logs(), 1)
        self.assertEqual(WebhookLog.objects.count(), 1)


class SystemStatusTests(PlatformBase):
    def test_system_status_shape_and_no_secrets(self):
        data = self.client.get("/api/admin/system/").json()
        self.assertEqual(data["checks"], {"database": "ok", "cache": "ok"})
        for key in ("services", "reminders", "leases", "webhooks", "alerts"):
            self.assertIn(key, data)
        self.assertIn("telegram_configured", data["services"])
        text = str(data).lower()
        self.assertNotIn("secret", text.replace("sms_configured", ""))  # значения ключей наружу не уходят
        self.login(self.user_a)
        self.assertEqual(self.client.get("/api/admin/system/").status_code, 403)

    def test_reminder_and_webhook_counters(self):
        from reminders.models import NotificationLog

        NotificationLog.objects.create(
            owner=self.user_a, kind="owner_summary", dedupe_key="a", chat_id=1, status="failed", error="Telegram вернул 403"
        )
        WebhookLog.objects.create(provider="payme", ok=False)
        data = self.client.get("/api/admin/system/").json()
        self.assertEqual(data["reminders"]["failed_24h"], 1)
        self.assertEqual(data["reminders"]["last_error"], "Telegram вернул 403")
        self.assertEqual(data["webhooks"]["failed_24h"], 1)
        self.assertIsNotNone(data["webhooks"]["last_payme_at"])


class AnnouncementTests(PlatformBase):
    def test_admin_crud_and_public_list(self):
        r = self.client.post(
            "/api/admin/announcements/", {"text_ru": "Завтра работы", "text_uz": "Ertaga", "level": "warning"}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.content)
        pk = r.json()["id"]
        self.client.post("/api/admin/announcements/", {"text_ru": "Выключено", "is_active": False}, format="json")
        self.assertEqual(AuditLog.objects.filter(action="admin_announcement_create").count(), 2)

        self.login(self.user_a)  # публичный список видит любой вошедший
        rows = self.client.get("/api/announcements/").json()
        self.assertEqual([(a["id"], a["level"], a["text_uz"]) for a in rows], [(pk, "warning", "Ertaga")])
        self.assertEqual(APIClient().get("/api/announcements/").status_code, 401)
        self.assertEqual(self.client.post("/api/admin/announcements/", {"text_ru": "x"}, format="json").status_code, 403)

        self.login(self.admin)
        self.assertEqual(self.client.patch(f"/api/admin/announcements/{pk}/", {"is_active": False}, format="json").status_code, 200)
        self.login(self.user_a)
        self.assertEqual(self.client.get("/api/announcements/").json(), [])
        self.login(self.admin)
        self.assertEqual(self.client.delete(f"/api/admin/announcements/{pk}/").status_code, 204)

    def test_text_required_and_limited(self):
        self.assertEqual(self.client.post("/api/admin/announcements/", {"text_ru": ""}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/admin/announcements/", {"text_ru": "x" * 501}, format="json").status_code, 400)


class PlanTests(PlatformBase):
    def _plan(self, **kw):
        data = {"name": "Старт", "max_properties": 1, "price": 50000, **kw}
        r = self.client.post("/api/admin/plans/", data, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()["id"]

    def test_plan_crud_and_assignment_shown_in_users(self):
        plan = self._plan()
        r = self.client.post(
            f"/api/admin/users/{self.user_a.pk}/subscription/",
            {"plan": plan, "paid_until": "2020-01-01", "note": "счёт №5"}, format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        info = r.json()["plan"]
        self.assertEqual((info["name"], info["expired"], info["note"]), ("Старт", True, "счёт №5"))
        row = next(u for u in self.client.get("/api/admin/users/").json()["results"] if u["id"] == self.user_a.pk)
        self.assertEqual(row["plan"]["id"], plan)
        self.assertEqual(self.client.get("/api/admin/plans/").json()[0]["users_count"], 1)
        self.assertTrue(AuditLog.objects.filter(action="admin_subscription_set", owner=self.user_a).exists())
        # снять тариф
        r = self.client.post(f"/api/admin/users/{self.user_a.pk}/subscription/", {"plan": None}, format="json")
        self.assertIsNone(r.json()["plan"])
        self.assertFalse(Subscription.objects.exists())

    def test_cannot_delete_used_or_assign_inactive_plan(self):
        plan = self._plan()
        self.client.post(f"/api/admin/users/{self.user_a.pk}/subscription/", {"plan": plan}, format="json")
        self.assertEqual(self.client.delete(f"/api/admin/plans/{plan}/").status_code, 400)
        off = self._plan(name="Старый", is_active=False)
        self.assertEqual(
            self.client.post(f"/api/admin/users/{self.user_b.pk}/subscription/", {"plan": off}, format="json").status_code, 400
        )
        self.assertEqual(self.client.post(f"/api/admin/users/{self.user_b.pk}/subscription/", {"plan": 9999}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/admin/plans/{off}/").status_code, 204)  # неиспользуемый — можно

    def test_property_limit_enforced_only_with_plan(self):
        payload = {"name": "Ещё", "address": "Ташкент"}
        self.login(self.user_a)
        self.make_property()
        self.assertEqual(self.client.post("/api/properties/", payload, format="json").status_code, 201)  # без тарифа — без лимита
        self.login(self.admin)
        plan = self._plan(max_properties=2)
        self.client.post(f"/api/admin/users/{self.user_a.pk}/subscription/", {"plan": plan}, format="json")
        self.login(self.user_a)
        r = self.client.post("/api/properties/", payload, format="json")  # уже 2 объекта
        self.assertEqual(r.status_code, 400)
        self.assertIn("Старт", str(r.json()))
        self.assertEqual(Property.objects.filter(owner=self.user_a).count(), 2)
        # у другого арендодателя лимит не действует
        self.login(self.user_b)
        self.assertEqual(self.client.post("/api/properties/", payload, format="json").status_code, 201)

    def test_unlimited_plan_and_validation(self):
        r = self.client.post("/api/admin/plans/", {"name": "Безлимит", "price": 1}, format="json")
        self.assertEqual((r.status_code, r.json()["max_properties"]), (201, None))
        self.assertEqual(self.client.post("/api/admin/plans/", {"name": "Безлимит"}, format="json").status_code, 400)  # имя занято
        self.assertEqual(self.client.post("/api/admin/plans/", {"name": "Z", "max_properties": 0}, format="json").status_code, 400)
        self.assertEqual(Plan.objects.count(), 1)


@override_settings(ADMIN_ALERT_PROBLEM_THRESHOLD=2)
class ProblemAlertTests(PlatformBase):
    def test_alert_sent_once_per_cooldown(self):
        pay = self.make_lease().payments.first()
        self.assertEqual(check_problem_payments(), 0)  # проблем нет
        self._tx(pay, "c1", -1)
        self.assertEqual(check_problem_payments(), 0)  # одна — ниже порога
        self._tx(pay, "c2", -2)
        self.assertEqual(check_problem_payments(), 1)
        self.assertEqual([m.to for m in mail.outbox], [["root@example.com"]])  # поддержке и арендодателям не пишем
        self.assertIn("2", mail.outbox[0].subject)
        self.assertTrue(AuditLog.objects.filter(action="admin_alert_problem_payments", owner=self.admin).exists())
        self.assertEqual(check_problem_payments(), 0)  # повторно в течение 12 часов — тишина
        AuditLog.objects.filter(action="admin_alert_problem_payments").update(created_at=timezone.now() - timedelta(hours=13))
        self.assertEqual(check_problem_payments(), 1)

    @override_settings(ADMIN_ALERT_PROBLEM_THRESHOLD=0)
    def test_alert_can_be_disabled(self):
        pay = self.make_lease().payments.first()
        self._tx(pay, "c1", -1)
        self._tx(pay, "c2", -1)
        self.assertEqual(check_problem_payments(), 0)

    def test_old_cancelled_do_not_count_but_stuck_do(self):
        pay = self.make_lease().payments.first()
        old = self._tx(pay, "old", -1)
        PaymentTransaction.objects.filter(pk=old.pk).update(updated_at=timezone.now() - timedelta(days=5))
        stuck = self._tx(pay, "stuck", 1)
        PaymentTransaction.objects.filter(pk=stuck.pk).update(created_at=timezone.now() - timedelta(days=3))
        self.assertEqual(check_problem_payments(), 0)  # давно отменённая не в счёт: 1 < 2
        stuck2 = self._tx(pay, "stuck2", 1)
        PaymentTransaction.objects.filter(pk=stuck2.pk).update(created_at=timezone.now() - timedelta(days=3))
        self.assertEqual(check_problem_payments(), 1)


class DjangoAdminAuditTests(PlatformBase):
    def test_audit_log_cannot_be_deleted_in_django_admin(self):
        from django.contrib import admin
        from django.test import RequestFactory

        from .models import AuditLog

        model_admin = admin.site._registry[AuditLog]
        request = RequestFactory().get("/admin/")
        request.user = self.admin
        self.assertFalse(model_admin.has_delete_permission(request))
        self.assertFalse(model_admin.has_change_permission(request))
        self.assertFalse(model_admin.has_add_permission(request))
