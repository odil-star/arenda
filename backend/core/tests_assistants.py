"""VIP: помощники — вход, границы доступа по ролям, отключение, журнал."""
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from leasing.models import Property
from users.models import User

from . import assistants
from .audit import log_action
from .models import Assistant, AuditLog, Plan, Subscription
from .testing import OwnerTestCase

OWNER_PHONE = "+998901112233"


def give(user, tier, paid_until=None):
    plan, _ = Plan.objects.get_or_create(name=f"T-{tier}", defaults={"tier": tier})
    Subscription.objects.update_or_create(user=user, defaults={"plan": plan, "paid_until": paid_until})
    user.refresh_from_db()


class AssistantBase(OwnerTestCase):
    def setUp(self):
        super().setUp()
        give(self.user_a, "vip")
        self.user_a.phone = OWNER_PHONE
        self.user_a.passport_data = "AA7654321"
        self.user_a.save()
        self.prop = self.make_property(name="Квартира владельца")
        self.foreign = self.make_property(owner=self.user_b, name="Чужая")

    def create(self, role, email="help@example.com", **extra):
        r = self.client.post("/api/assistants/", {"email": email, "first_name": "Помощник", "role": role, **extra},
                             format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def login_as(self, email, password):
        anon = APIClient()
        r = anon.post("/api/auth/token/", {"email": email, "password": password}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
        return client

    def assistant_client(self, role, email="help@example.com"):
        made = self.create(role, email)
        return self.login_as(email, made["password"]), made


class ManagementTests(AssistantBase):
    def test_free_owner_cannot_create(self):
        give(self.user_a, "prime")
        r = self.client.post("/api/assistants/", {"email": "x@example.com", "first_name": "X", "role": "manager"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_create_returns_password_once_and_lists_without_it(self):
        made = self.create("accountant")
        self.assertTrue(made["password"])
        rows = self.client.get("/api/assistants/").json()["results"]
        self.assertEqual([r["email"] for r in rows], ["help@example.com"])
        self.assertNotIn("password", rows[0])

    def test_duplicate_email_and_limit(self):
        self.create("manager")
        dup = self.client.post("/api/assistants/", {"email": "HELP@example.com", "first_name": "X", "role": "manager"}, format="json")
        self.assertEqual(dup.status_code, 400)
        taken = self.client.post("/api/assistants/", {"email": "b@example.com", "first_name": "X", "role": "manager"}, format="json")
        self.assertEqual(taken.status_code, 400)  # email другого владельца
        for i in range(4):
            self.create("manager", f"h{i}@example.com")
        over = self.client.post("/api/assistants/", {"email": "h9@example.com", "first_name": "X", "role": "manager"}, format="json")
        self.assertEqual(over.status_code, 400)

    def test_cannot_touch_other_owners_assistant(self):
        made = self.create("manager")
        self.login(self.user_b)
        give(self.user_b, "vip")
        self.assertEqual(self.client.patch(f"/api/assistants/{made['id']}/", {"is_active": False}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/assistants/{made['id']}/").status_code, 404)
        self.assertEqual(self.client.get("/api/assistants/").json()["results"], [])

    def test_reset_password_invalidates_old(self):
        made = self.create("manager")
        r = self.client.post(f"/api/assistants/{made['id']}/reset-password/")
        self.assertNotEqual(r.json()["password"], made["password"])
        bad = APIClient().post("/api/auth/token/", {"email": "help@example.com", "password": made["password"]}, format="json")
        self.assertEqual(bad.status_code, 401)
        self.login_as("help@example.com", r.json()["password"])


class AccessTests(AssistantBase):
    def test_sees_owner_data_only(self):
        client, _ = self.assistant_client("manager")
        names = [x["name"] for x in client.get("/api/properties/").json()["results"]]
        self.assertEqual(names, ["Квартира владельца"])
        self.assertEqual(client.get(f"/api/properties/{self.foreign.pk}/").status_code, 404)

    def test_me_shows_assistant_not_owner(self):
        client, made = self.assistant_client("accountant")
        me = client.get("/api/me/").json()
        self.assertEqual((me["email"], me["assistant"]["role"]), ("help@example.com", "accountant"))
        blob = str(me)
        for secret in ("a@example.com", OWNER_PHONE, "AA7654321"):
            self.assertNotIn(secret, blob)

    def test_account_level_endpoints_are_closed_for_both_roles(self):
        for role, email in (("manager", "m@example.com"), ("accountant", "a2@example.com")):
            client, _ = self.assistant_client(role, email)
            for method, url in (
                ("patch", "/api/me/"), ("post", "/api/me/password/"), ("post", "/api/me/telegram-link/"),
                ("delete", "/api/me/telegram-link/"), ("post", "/api/tour/"), ("get", "/api/integrations/"),
                ("post", "/api/integrations/api-key/"), ("get", "/api/contract-brand/"), ("put", "/api/contract-brand/"),
                ("get", "/api/audit/"), ("get", "/api/assistants/"), ("post", "/api/assistants/"),
                ("get", "/api/support/messages/"), ("get", "/api/admin/users/"), ("get", "/api/v1/payments/"),
                ("get", "/api/push/key/"),
            ):
                r = getattr(client, method)(url, {}, format="json") if method != "get" else client.get(url)
                self.assertIn(r.status_code, (401, 403), f"{role} {method} {url} -> {r.status_code}")

    def test_accountant_reads_but_cannot_change(self):
        client, _ = self.assistant_client("accountant")
        for url in ("/api/properties/", "/api/tenants/", "/api/leases/", "/api/payments/", "/api/dashboard/",
                    "/api/expenses/", "/api/reports/summary/"):
            self.assertEqual(client.get(url).status_code, 200, url)
        self.assertEqual(client.post("/api/properties/", {"name": "X", "address": "Y"}, format="json").status_code, 403)
        self.assertEqual(client.patch(f"/api/properties/{self.prop.pk}/", {"name": "Z"}, format="json").status_code, 403)
        self.assertEqual(client.get("/api/documents/").status_code, 403)  # сканы паспортов бухгалтеру не нужны
        r = client.post("/api/expenses/", {"property": self.prop.pk, "category": "repair", "amount": 1000,
                                            "expense_date": timezone.localdate().isoformat()}, format="json")
        self.assertNotEqual(r.status_code, 403, r.content)  # расходы бухгалтер вести может

    def test_manager_edits_but_never_deletes(self):
        client, _ = self.assistant_client("manager")
        created = client.post("/api/properties/", {"name": "Новая", "address": "Адрес"}, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertTrue(Property.objects.filter(owner=self.user_a, name="Новая").exists())
        self.assertEqual(client.patch(f"/api/properties/{created.json()['id']}/", {"name": "Ещё"}, format="json").status_code, 200)
        self.assertEqual(client.delete(f"/api/properties/{created.json()['id']}/").status_code, 403)
        self.assertTrue(Property.objects.filter(pk=created.json()["id"]).exists())

    def test_deactivated_and_deleted_assistants_lose_access(self):
        client, made = self.assistant_client("manager")
        self.assertEqual(client.get("/api/properties/").status_code, 200)
        self.client.patch(f"/api/assistants/{made['id']}/", {"is_active": False}, format="json")
        self.assertIn(client.get("/api/properties/").status_code, (401, 403))
        self.client.patch(f"/api/assistants/{made['id']}/", {"is_active": True}, format="json")
        self.assertEqual(client.get("/api/properties/").status_code, 200)
        self.client.delete(f"/api/assistants/{made['id']}/")
        self.assertEqual(client.get("/api/properties/").status_code, 401)
        self.assertFalse(User.objects.filter(email="help@example.com").exists())

    def test_role_change_applies_immediately(self):
        client, made = self.assistant_client("manager")
        self.assertEqual(client.get("/api/documents/").status_code, 200)
        self.client.patch(f"/api/assistants/{made['id']}/", {"role": "accountant"}, format="json")
        self.assertEqual(client.get("/api/documents/").status_code, 403)

    def test_access_ends_when_owner_vip_ends(self):
        client, _ = self.assistant_client("manager")
        give(self.user_a, "prime")
        self.assertEqual(client.get("/api/properties/").status_code, 403)
        give(self.user_a, "vip", timezone.localdate() - timedelta(days=1))
        self.assertEqual(client.get("/api/properties/").status_code, 403)
        give(self.user_a, "vip")
        self.assertEqual(client.get("/api/properties/").status_code, 200)

    def test_owner_is_not_affected(self):
        self.create("manager")
        self.assertEqual(self.client.get("/api/me/").json()["email"], "a@example.com")
        self.assertEqual(self.client.get("/api/integrations/").status_code, 200)


class AuditTests(AssistantBase):
    def test_actions_by_assistant_are_marked_in_log(self):
        client, made = self.assistant_client("manager")
        lease = self.make_lease(prop=self.prop)
        payment = lease.payments.order_by("due_date").first()
        r = client.post(f"/api/payments/{payment.pk}/pay/", {"amount": 1000}, format="json")
        self.assertLess(r.status_code, 300, r.content)
        row = AuditLog.objects.filter(owner=self.user_a, action="payment.paid").first()
        self.assertIsNotNone(row, r.content)
        self.assertEqual(row.details["by_assistant"], "help@example.com")
        self.assertEqual(row.details["assistant_role"], "manager")

    def test_owner_actions_are_not_marked_and_context_resets(self):
        link = Assistant.objects.create(owner=self.user_a, user=User.objects.create_user("z@example.com", "x"), role="manager")
        assistants.set_current(link)
        marked = log_action(self.user_a, "x", actor=self.user_a)
        self.assertIn("by_assistant", marked.details)
        self.client.get("/api/dashboard/")  # любой запрос владельца сбрасывает значение
        self.assertIsNone(assistants.current_assistant())
        self.assertNotIn("by_assistant", log_action(self.user_a, "y", actor=self.user_a).details)
