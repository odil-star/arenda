import re
from datetime import timedelta

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AuditLog
from core.phone import normalize_phone
from core.testing import OwnerTestCase
from leasing.models import Lease, Tenant
from users.models import User, UserProfile

from .models import Invite, PhoneOTP
from .services import create_tenant_user
from .sms import LocMemSmsBackend

TENANT_PASSWORD = "T3nant-pass-987"


class PortalCase(OwnerTestCase):
    """Арендодатели A и B из базового класса + помощники для жильцов."""

    def setUp(self):
        super().setUp()
        self.anon = APIClient()

    def invite(self, tenant, as_user=None):
        if as_user:
            self.login(as_user)
        r = self.client.post(f"/api/tenants/{tenant.pk}/invite/")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()["url"].rsplit("/", 1)[1], r.json()

    def make_tenant_user(self, email="tenant@example.com"):
        return create_tenant_user(email=email, password=TENANT_PASSWORD)

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def accept(self, token, user):
        return self.client_for(user).post("/api/invites/accept/", {"token": token}, format="json")


class InviteFlowTests(PortalCase):
    def test_full_flow_tenant_sees_only_own_lease_and_payments(self):
        tenant = self.make_tenant(name="Жилец 1")
        lease = self.make_lease(tenant=tenant)
        other_lease = self.make_lease(tenant=self.make_tenant(name="Жилец 2"))  # другой жилец того же арендодателя
        token, body = self.invite(tenant)
        self.assertTrue(body["url"].endswith(f"/join/{token}"))
        self.assertIn("expires_at", body)

        user = self.make_tenant_user()
        r = self.accept(token, user)
        self.assertEqual(r.status_code, 200, r.content)

        tenant.refresh_from_db()
        self.assertEqual(tenant.user_id, user.pk)
        client = self.client_for(user)
        leases = client.get("/api/tenant/leases/").json()["results"]
        self.assertEqual([x["id"] for x in leases], [lease.pk])
        self.assertNotIn("notes", leases[0])
        payments = client.get("/api/tenant/payments/").json()["results"]
        self.assertTrue(payments)
        self.assertEqual({p["lease"] for p in payments}, {lease.pk})
        self.assertNotIn(other_lease.pk, {p["lease"] for p in payments})
        self.assertEqual(client.get("/api/tenant/payments/?status=paid").json()["count"], 0)
        self.assertGreater(client.get("/api/tenant/payments/?status=overdue").json()["count"], 0)
        me = client.get("/api/tenant/me/").json()
        self.assertEqual([x["tenant"] for x in me["landlords"]], [tenant.pk])

        self.login(self.user_a)
        data = self.client.get(f"/api/tenants/{tenant.pk}/").json()
        self.assertEqual((data["is_linked"], data["invite_status"]), (True, "used"))
        actions = set(AuditLog.objects.filter(owner=self.user_a).values_list("action", flat=True))
        self.assertTrue({"invite.created", "invite.accepted", "tenant.linked"} <= actions)

    def test_token_is_never_stored_in_plain_text(self):
        tenant = self.make_tenant()
        token, _ = self.invite(tenant)
        invite = Invite.objects.get()
        self.assertNotEqual(invite.token_hash, token)
        self.assertEqual(len(invite.token_hash), 64)
        self.assertNotIn(token, str(AuditLog.objects.values_list("details", flat=True)))
        self.assertGreater(invite.expires_at, timezone.now() + timedelta(days=6))

    def test_invite_status_values(self):
        tenant = self.make_tenant()
        self.assertEqual(self.client.get(f"/api/tenants/{tenant.pk}/").json()["invite_status"], "none")
        self.invite(tenant)
        self.assertEqual(self.client.get(f"/api/tenants/{tenant.pk}/").json()["invite_status"], "pending")
        Invite.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        data = self.client.get(f"/api/tenants/{tenant.pk}/").json()
        self.assertEqual((data["invite_status"], data["is_linked"]), ("expired", False))

    def test_invalid_tokens_give_identical_404(self):
        tenant = self.make_tenant()
        used_token, _ = self.invite(tenant)
        self.assertEqual(self.accept(used_token, self.make_tenant_user("u1@example.com")).status_code, 200)

        t2 = self.make_tenant(name="Второй")
        expired, _ = self.invite(t2)
        Invite.objects.filter(tenant=t2).update(expires_at=timezone.now() - timedelta(seconds=1))
        t3 = self.make_tenant(name="Третий")
        revoked, _ = self.invite(t3)
        Invite.objects.filter(tenant=t3).update(revoked_at=timezone.now())
        t4 = self.make_tenant(name="Четвёртый")
        valid, _ = self.invite(t4)
        forged = valid[:-1] + ("A" if valid[-1] != "A" else "B")

        user = self.make_tenant_user("u2@example.com")
        bodies = set()
        for token in (used_token, expired, revoked, forged, "x" * 43, "short"):
            preview = self.anon.get(f"/api/invites/{token}/")
            accept = self.accept(token, user)
            self.assertEqual((preview.status_code, accept.status_code), (404, 404), token)
            bodies.add((preview.content, accept.content))
        self.assertEqual(len({b[0] for b in bodies}), 1)
        self.assertEqual(len({b[1] for b in bodies}), 1)
        self.assertEqual(Tenant.objects.get(pk=t4.pk).user_id, None)

    def test_new_invite_revokes_previous(self):
        tenant = self.make_tenant()
        old, _ = self.invite(tenant)
        new, _ = self.invite(tenant)
        self.assertNotEqual(old, new)
        self.assertEqual(self.anon.get(f"/api/invites/{old}/").status_code, 404)
        self.assertEqual(self.anon.get(f"/api/invites/{new}/").status_code, 200)
        self.assertEqual(self.accept(old, self.make_tenant_user()).status_code, 404)
        self.assertEqual(Invite.objects.filter(tenant=tenant, revoked_at__isnull=False).count(), 1)
        self.assertTrue(AuditLog.objects.filter(action="invite.revoked").exists())

    def test_preview_has_no_sensitive_data(self):
        self.user_a.first_name = "Алишер"
        self.user_a.phone = "+998909999999"
        self.user_a.save()
        tenant = self.make_tenant(passport="AA1234567")
        prop = self.make_property(name="Кв. Юнусабад")
        self.make_lease(prop=prop, tenant=tenant)
        token, _ = self.invite(tenant)
        r = self.anon.get(f"/api/invites/{token}/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"valid": True, "landlord_name": "Алишер", "property_name": "Кв. Юнусабад",
                                     "needs_profile": False})
        for secret in ("AA1234567", "a@example.com", "+998909999999", "+998900000000"):
            self.assertNotIn(secret, r.content.decode())

    def test_preview_without_name_does_not_leak_email(self):
        tenant = self.make_tenant()
        token, _ = self.invite(tenant)
        r = self.anon.get(f"/api/invites/{token}/")
        self.assertNotIn("a@example.com", r.content.decode())
        self.assertEqual(r.json()["landlord_name"], "Арендодатель")

    def test_unlink_cuts_access_immediately(self):
        tenant = self.make_tenant()
        self.make_lease(tenant=tenant)
        token, _ = self.invite(tenant)
        user = self.make_tenant_user()
        self.accept(token, user)
        client = self.client_for(user)
        self.assertEqual(client.get("/api/tenant/leases/").json()["count"], 1)

        r = self.client.post(f"/api/tenants/{tenant.pk}/unlink/")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual((data["is_linked"], data["invite_status"], data["phone_claim_enabled"]),
                         (False, "none", False))
        self.assertEqual(client.get("/api/tenant/leases/").json()["count"], 0)
        self.assertEqual(client.get("/api/tenant/payments/").json()["count"], 0)
        self.assertTrue(AuditLog.objects.filter(action="tenant.unlinked", object_id=tenant.pk).exists())
        # использованное приглашение повторно не работает
        self.assertEqual(self.accept(token, user).status_code, 404)

    def test_unlink_revokes_pending_invites(self):
        tenant = self.make_tenant()
        token, _ = self.invite(tenant)
        self.client.post(f"/api/tenants/{tenant.pk}/unlink/")
        self.assertEqual(self.anon.get(f"/api/invites/{token}/").status_code, 404)

    def test_cannot_invite_linked_tenant_or_foreign_tenant(self):
        tenant = self.make_tenant()
        token, _ = self.invite(tenant)
        self.accept(token, self.make_tenant_user())
        self.assertEqual(self.client.post(f"/api/tenants/{tenant.pk}/invite/").status_code, 400)
        foreign = self.make_tenant(owner=self.user_b)
        self.assertEqual(self.client.post(f"/api/tenants/{foreign.pk}/invite/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/tenants/{foreign.pk}/unlink/").status_code, 404)

    def test_landlord_cannot_accept_invite(self):
        tenant = self.make_tenant()
        token, _ = self.invite(tenant)
        self.assertEqual(self.accept(token, self.user_b).status_code, 403)
        self.assertEqual(Tenant.objects.get(pk=tenant.pk).user_id, None)

    def test_accept_requires_authentication(self):
        tenant = self.make_tenant()
        token, _ = self.invite(tenant)
        self.assertEqual(self.anon.post("/api/invites/accept/", {"token": token}, format="json").status_code, 401)

    def test_qr_returns_svg_for_valid_token_only(self):
        tenant = self.make_tenant()
        other = self.make_tenant(name="Другой")
        token, body = self.invite(tenant)
        other_token, _ = self.invite(other)
        r = self.client.get(f"/api/tenants/{tenant.pk}/invite/qr/", {"token": token})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "image/svg+xml")
        self.assertIn(b"<svg", r.content)
        self.assertEqual(r["Cache-Control"], "no-store")
        for bad in ("", "nonsense-token-nonsense-token-123", other_token):
            r = self.client.get(f"/api/tenants/{tenant.pk}/invite/qr/", {"token": bad})
            self.assertEqual(r.status_code, 404)
        self.login(self.user_b)
        self.assertEqual(self.client.get(f"/api/tenants/{tenant.pk}/invite/qr/", {"token": token}).status_code, 404)

    def test_register_tenant_in_one_request(self):
        tenant = self.make_tenant()
        self.make_lease(tenant=tenant)
        token, _ = self.invite(tenant)
        bad = self.anon.post("/api/auth/register-tenant/", {
            "email": "x@example.com", "password": TENANT_PASSWORD, "token": token[:-1] + "_"}, format="json")
        self.assertEqual(bad.status_code, 404)
        self.assertFalse(User.objects.filter(email="x@example.com").exists())

        r = self.anon.post("/api/auth/register-tenant/", {
            "email": "x@example.com", "password": TENANT_PASSWORD, "token": token, "first_name": "Ваня"},
            format="json")
        self.assertEqual(r.status_code, 201, r.content)
        user = User.objects.get(email="x@example.com")
        self.assertEqual(user.profile.role, "tenant")
        self.assertEqual(Tenant.objects.get(pk=tenant.pk).user_id, user.pk)
        tokens = self.anon.post("/api/auth/token/", {"email": "x@example.com", "password": TENANT_PASSWORD},
                                format="json").json()
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(client.get("/api/tenant/leases/").json()["count"], 1)
        # токен уже использован
        again = self.anon.post("/api/auth/register-tenant/", {
            "email": "y@example.com", "password": TENANT_PASSWORD, "token": token}, format="json")
        self.assertEqual(again.status_code, 404)
        self.assertFalse(User.objects.filter(email="y@example.com").exists())

    def test_public_endpoints_are_throttled(self):
        codes = [self.anon.get("/api/invites/nonexistent-token-nonexistent-1/").status_code for _ in range(32)]
        self.assertEqual(codes[:30], [404] * 30)
        self.assertEqual(codes[30:], [429, 429])
        user = self.make_tenant_user()
        client = self.client_for(user)
        codes = [client.post("/api/invites/accept/", {"token": "n" * 40}, format="json").status_code
                 for _ in range(12)]
        self.assertEqual(codes[:10], [404] * 10)
        self.assertEqual(codes[10:], [429, 429])


class PropertyInviteTests(PortalCase):
    def test_invite_and_qr_from_property(self):
        prop = self.make_property()
        tenant = self.make_tenant()
        lease = self.make_lease(prop=prop, tenant=tenant)
        r = self.client.post(f"/api/properties/{prop.pk}/invite/")
        self.assertEqual(r.status_code, 201, r.content)
        token = r.json()["url"].rsplit("/", 1)[1]
        self.assertEqual(r.json()["tenant"], tenant.pk)
        qr = self.client.get(f"/api/properties/{prop.pk}/invite/qr/", {"token": token})
        self.assertEqual((qr.status_code, qr["Content-Type"]), (200, "image/svg+xml"))
        self.assertEqual(self.client.get(f"/api/properties/{prop.pk}/invite/qr/", {"token": "x" * 40}).status_code, 404)
        user = self.make_tenant_user()
        self.assertEqual(self.accept(token, user).status_code, 200)
        leases = self.client_for(user).get("/api/tenant/leases/").json()["results"]
        self.assertEqual([x["id"] for x in leases], [lease.pk])

    def test_no_active_lease_foreign_property_and_tenant_role(self):
        prop = self.make_property()
        self.make_lease(prop=prop)
        self.login(self.user_b)
        self.assertEqual(self.client.post(f"/api/properties/{prop.pk}/invite/").status_code, 404)
        self.assertEqual(self.client_for(self.make_tenant_user()).post(
            f"/api/properties/{prop.pk}/invite/").status_code, 403)


class PropertyInviteSelfRegistrationTests(PortalCase):
    def test_object_without_lease_tenant_enters_own_data(self):
        prop = self.make_property(name="Кв. Чиланзар")
        r = self.client.post(f"/api/properties/{prop.pk}/invite/")
        self.assertEqual(r.status_code, 201, r.content)
        token = r.json()["url"].rsplit("/", 1)[1]
        preview = self.anon.get(f"/api/invites/{token}/").json()
        self.assertEqual((preview["property_name"], preview["needs_profile"]), ("Кв. Чиланзар", True))
        # повторное приглашение переиспользует ту же заготовку жильца
        r2 = self.client.post(f"/api/properties/{prop.pk}/invite/")
        self.assertEqual(r2.json()["tenant"], r.json()["tenant"])
        token = r2.json()["url"].rsplit("/", 1)[1]
        self.assertEqual(Tenant.objects.filter(owner=self.user_a).count(), 1)

        bad = self.client_for(self.make_tenant_user()).post(
            "/api/invites/accept/", {"token": token, "full_name": "Али", "phone": "123"}, format="json")
        self.assertEqual(bad.status_code, 400)
        r = self.anon.post("/api/auth/register-tenant/", {
            "email": "ali@example.com", "password": TENANT_PASSWORD, "token": token,
            "full_name": "Али Валиев", "phone": "90 111 22 33"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        tenant = Tenant.objects.get(pk=r2.json()["tenant"])
        self.assertEqual((tenant.full_name, tenant.phone, tenant.phone_claim_enabled),
                         ("Али Валиев", "+998901112233", False))
        self.assertIsNotNone(tenant.user_id)
        # арендодатель видит жильца и может оформить на него договор
        data = self.client.get(f"/api/tenants/{tenant.pk}/").json()
        self.assertEqual((data["full_name"], data["is_linked"]), ("Али Валиев", True))

    def test_tenant_cannot_overwrite_name_set_by_landlord(self):
        tenant = self.make_tenant(name="Иванов Иван")
        token, _ = self.invite(tenant)
        self.accept(token, self.make_tenant_user(), )
        tenant2 = self.make_tenant(name="Петров Пётр")
        token2, _ = self.invite(tenant2)
        r = self.client_for(self.make_tenant_user("o@example.com")).post(
            "/api/invites/accept/", {"token": token2, "full_name": "Хакер"}, format="json")
        self.assertEqual(r.status_code, 200)
        tenant2.refresh_from_db()
        self.assertEqual(tenant2.full_name, "Петров Пётр")


class TenantIsolationTests(PortalCase):
    def test_tenants_do_not_see_each_other_or_other_landlords(self):
        t1 = self.make_tenant(name="Жилец 1")
        t2 = self.make_tenant(name="Жилец 2")
        tb = self.make_tenant(owner=self.user_b, name="Жилец B")
        l1, l2 = self.make_lease(tenant=t1), self.make_lease(tenant=t2)
        lb = self.make_lease(owner=self.user_b, tenant=tb)
        u1, u2 = self.make_tenant_user("t1@example.com"), self.make_tenant_user("t2@example.com")
        self.accept(self.invite(t1)[0], u1)
        self.accept(self.invite(t2)[0], u2)
        self.assertEqual([x["id"] for x in self.client_for(u1).get("/api/tenant/leases/").json()["results"]], [l1.pk])
        self.assertEqual([x["id"] for x in self.client_for(u2).get("/api/tenant/leases/").json()["results"]], [l2.pk])
        pay_ids = {p["id"] for p in self.client_for(u1).get("/api/tenant/payments/").json()["results"]}
        self.assertFalse(pay_ids & set(l2.payments.values_list("pk", flat=True)))
        self.assertFalse(pay_ids & set(lb.payments.values_list("pk", flat=True)))
        # фильтр по чужому договору не раскрывает его существование
        r = self.client_for(u1).get(f"/api/tenant/payments/?lease={lb.pk}")
        self.assertEqual(r.json()["count"], len(pay_ids))

    def test_tenant_cannot_call_landlord_endpoints(self):
        tenant = self.make_tenant()
        user = self.make_tenant_user()
        self.accept(self.invite(tenant)[0], user)
        client = self.client_for(user)
        for url in ("/api/properties/", "/api/tenants/", "/api/leases/", "/api/payments/", "/api/documents/",
                    "/api/dashboard/", "/api/audit/", "/api/me/", "/api/meter-readings/", "/api/expenses/",
                    "/api/reports/summary/"):
            self.assertEqual(client.get(url).status_code, 403, url)
        self.assertEqual(client.post(f"/api/tenants/{tenant.pk}/invite/").status_code, 403)
        self.assertEqual(client.post(f"/api/tenants/{tenant.pk}/unlink/").status_code, 403)
        self.assertEqual(client.post("/api/payments/1/pay/", {"amount": 1}, format="json").status_code, 403)

    def test_tenant_updates_own_profile(self):
        user = self.make_tenant_user()
        client = self.client_for(user)
        r = client.patch("/api/tenant/me/", {"phone": "90 123 45 67", "first_name": "Дилноза", "language": "uz"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["phone"], r.json()["first_name"], r.json()["language"]), ("+998901234567", "Дилноза", "uz"))
        user.refresh_from_db()
        self.assertEqual(user.phone, "+998901234567")
        self.assertEqual(client.patch("/api/tenant/me/", {"phone": "123"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch("/api/tenant/me/", {"phone": "+998901234567"}, format="json").status_code, 403)

    def test_tenant_sets_password_and_logs_in_by_phone(self):
        from .services import _phone_user
        user = _phone_user("+998901234567")
        client = self.client_for(user)
        self.assertFalse(client.get("/api/tenant/me/").json()["has_password"])
        self.assertEqual(client.post("/api/tenant/password/", {"password": "123"}, format="json").status_code, 400)
        self.assertEqual(client.post("/api/tenant/password/", {"password": "T3nant-pass-987"}, format="json").status_code, 204)
        self.assertTrue(client.get("/api/tenant/me/").json()["has_password"])
        # смена требует текущий пароль
        self.assertEqual(client.post("/api/tenant/password/", {"password": "Other-pass-9876"}, format="json").status_code, 400)
        r = self.anon.post("/api/auth/phone/password/", {"phone": "90 123 45 67", "password": "T3nant-pass-987"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn("access", r.json())
        bad = self.anon.post("/api/auth/phone/password/", {"phone": "+998901234567", "password": "nope"}, format="json")
        self.assertEqual(bad.status_code, 401)
        none = self.anon.post("/api/auth/phone/password/", {"phone": "+998900000000", "password": "x"}, format="json")
        self.assertEqual(none.status_code, 401)

    def test_landlord_cannot_call_tenant_endpoints(self):
        for url in ("/api/tenant/me/", "/api/tenant/leases/", "/api/tenant/payments/"):
            self.assertEqual(self.client.get(url).status_code, 403, url)

    def test_one_tenant_linked_to_two_landlords(self):
        ta, tb = self.make_tenant(), self.make_tenant(owner=self.user_b)
        la, lb = self.make_lease(tenant=ta), self.make_lease(owner=self.user_b, tenant=tb)
        other = self.make_lease(owner=self.user_b, tenant=self.make_tenant(owner=self.user_b, name="Чужой"))
        user = self.make_tenant_user()
        self.accept(self.invite(ta)[0], user)
        self.accept(self.invite(tb, as_user=self.user_b)[0], user)
        client = self.client_for(user)
        ids = {x["id"] for x in client.get("/api/tenant/leases/").json()["results"]}
        self.assertEqual(ids, {la.pk, lb.pk})
        self.assertNotIn(other.pk, ids)
        self.assertEqual(len(client.get("/api/tenant/me/").json()["landlords"]), 2)

    def test_tenant_hides_only_ended_lease(self):
        tenant = self.make_tenant()
        active = self.make_lease(tenant=tenant)
        ended = self.make_lease(tenant=tenant)
        Lease.objects.filter(pk=ended.pk).update(status=Lease.Status.ENDED)
        token, _ = self.invite(tenant)
        user = self.make_tenant_user()
        self.accept(token, user)
        client = self.client_for(user)

        self.assertEqual(client.post(f"/api/tenant/leases/{active.pk}/hide/").status_code, 400)
        self.assertEqual(client.post(f"/api/tenant/leases/{ended.pk}/hide/").status_code, 204)
        self.assertEqual([x["id"] for x in client.get("/api/tenant/leases/").json()["results"]], [active.pk])
        self.assertNotIn(ended.pk, {p["lease"] for p in client.get("/api/tenant/payments/").json()["results"]})
        # у арендодателя договор на месте
        self.assertTrue(Lease.objects.filter(pk=ended.pk, hidden_by_tenant=True).exists())
        self.assertEqual(self.client.get(f"/api/leases/{ended.pk}/").status_code, 200)
        # чужой жилец скрыть чужой договор не может
        other = self.client_for(self.make_tenant_user("other@example.com"))
        self.assertEqual(other.post(f"/api/tenant/leases/{active.pk}/hide/").status_code, 404)

    def test_existing_users_get_landlord_role(self):
        self.assertEqual(self.user_a.profile.role, UserProfile.Role.LANDLORD)
        r = self.anon.post("/api/auth/register/", {"email": "new@example.com", "password": "Str0ng-pass-987"},
                           format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(User.objects.get(email="new@example.com").profile.role, "landlord")


class PhoneNormalizationTests(PortalCase):
    def test_all_forms_give_one_format(self):
        for raw in ("+998901234567", "998901234567", "90 123 45 67", "+998 (90) 123-45-67", "901234567"):
            self.assertEqual(normalize_phone(raw), "+998901234567", raw)

    def test_invalid_numbers_rejected(self):
        for raw in ("", "123", "+79001234567", "99890123456", "abc"):
            with self.assertRaises(ValidationError):
                normalize_phone(raw)

    def test_api_stores_normalized_and_rejects_garbage(self):
        r = self.client.post("/api/tenants/", {"full_name": "Тест", "phone": "90 123 45 67"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["phone"], "+998901234567")
        r = self.client.post("/api/tenants/", {"full_name": "Плохой", "phone": "12345"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("phone", r.json())
        r = self.client.post("/api/tenants/", {"full_name": "Без телефона"}, format="json")
        self.assertEqual(r.status_code, 201)


@override_settings(SMS_BACKEND="locmem")
class PhoneOtpTests(PortalCase):
    phone = "+998901234567"

    def setUp(self):
        super().setUp()
        LocMemSmsBackend.outbox.clear()

    def request_code(self, phone=None, client=None):
        return (client or self.anon).post("/api/auth/phone/request/", {"phone": phone or self.phone}, format="json")

    def last_code(self):
        return re.search(r"\b(\d{6})\b", LocMemSmsBackend.outbox[-1][1]).group(1)

    def verify(self, code, phone=None):
        return self.anon.post("/api/auth/phone/verify/", {"phone": phone or self.phone, "code": code}, format="json")

    def make_claimable(self, owner=None, **kw):
        return Tenant.objects.create(owner=owner or self.user_a, full_name="Жилец", phone=self.phone, **kw)

    def test_valid_code_links_tenant_and_returns_jwt(self):
        tenant = self.make_claimable()
        lease = self.make_lease(tenant=tenant)
        self.assertEqual(self.request_code().status_code, 200)
        self.assertEqual(LocMemSmsBackend.outbox[-1][0], self.phone)
        r = self.verify(self.last_code(), phone="90 123 45 67")
        self.assertEqual(r.status_code, 200, r.content)
        tokens = r.json()
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual([x["id"] for x in client.get("/api/tenant/leases/").json()["results"]], [lease.pk])
        tenant.refresh_from_db()
        user = User.objects.get(pk=tenant.user_id)
        self.assertEqual((user.profile.role, user.phone), ("tenant", self.phone))
        log = AuditLog.objects.get(action="tenant.linked")
        self.assertEqual((log.object_id, log.actor_id, log.details["method"]), (tenant.pk, user.pk, "phone"))
        self.assertEqual(PhoneOTP.objects.count(), 0)
        self.assertEqual(self.client_for(user).get("/api/me/").status_code, 403)
        # refresh-токен рабочий
        self.assertEqual(self.anon.post("/api/auth/token/refresh/", {"refresh": tokens["refresh"]},
                                        format="json").status_code, 200)

    def test_code_is_stored_hashed_and_single_use(self):
        self.request_code()
        code = self.last_code()
        otp = PhoneOTP.objects.get()
        self.assertNotIn(code, otp.code_hash)
        self.assertGreater(otp.expires_at, timezone.now() + timedelta(minutes=4))
        self.assertEqual(self.verify(code).status_code, 200)
        self.assertEqual(self.verify(code).status_code, 400)

    def test_wrong_code(self):
        self.make_claimable()
        self.request_code()
        wrong = "000000" if self.last_code() != "000000" else "111111"
        r = self.verify(wrong)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(PhoneOTP.objects.get().attempts, 1)
        self.assertFalse(Tenant.objects.get().user_id)

    def test_attempt_limit_blocks_even_correct_code(self):
        self.make_claimable()
        self.request_code()
        code = self.last_code()
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(5):
            self.assertEqual(self.verify(wrong).status_code, 400)
        self.assertEqual(self.verify(code).status_code, 400)
        self.assertFalse(Tenant.objects.get().user_id)

    def test_expired_code(self):
        self.make_claimable()
        self.request_code()
        PhoneOTP.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.verify(self.last_code()).status_code, 400)
        self.assertFalse(Tenant.objects.get().user_id)

    def test_request_limit_per_number_and_per_ip(self):
        codes = [self.request_code().status_code for _ in range(4)]
        self.assertEqual(codes, [200, 200, 200, 429])
        # другой номер с другого IP — не заблокирован общим лимитом номера
        other_ip = APIClient(REMOTE_ADDR="10.0.0.9")
        self.assertEqual(self.request_code("+998931112233", client=other_ip).status_code, 200)
        # тот же IP, разные номера: 4-й запрос с IP блокируется
        ip = APIClient(REMOTE_ADDR="10.0.0.7")
        codes = [self.request_code(f"+99890000000{i}", client=ip).status_code for i in range(4)]
        self.assertEqual(codes, [200, 200, 200, 429])

    def test_request_response_is_identical_for_any_number(self):
        self.make_claimable()
        known = self.request_code()
        unknown = self.request_code("+998931112233", client=APIClient(REMOTE_ADDR="10.0.0.2"))
        garbage = self.request_code("abc", client=APIClient(REMOTE_ADDR="10.0.0.3"))
        self.assertEqual((known.status_code, unknown.status_code, garbage.status_code), (200, 200, 200))
        self.assertEqual(known.content, unknown.content)
        self.assertEqual(known.content, garbage.content)

    def test_number_without_tenant_creates_account_without_links(self):
        self.request_code("+998931112233")
        r = self.verify(self.last_code(), phone="+998931112233")
        self.assertEqual(r.status_code, 200)
        user = User.objects.get(phone="+998931112233")
        self.assertEqual(user.profile.role, "tenant")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
        self.assertEqual(client.get("/api/tenant/leases/").json()["count"], 0)
        self.assertEqual(client.get("/api/tenant/me/").json()["landlords"], [])
        self.assertFalse(AuditLog.objects.filter(action="tenant.linked").exists())

    def test_repeated_login_reuses_same_account(self):
        for _ in range(2):
            self.request_code()
            self.assertEqual(self.verify(self.last_code()).status_code, 200)
            cache.clear()
        self.assertEqual(User.objects.filter(phone=self.phone).count(), 1)

    def test_claim_disabled_does_not_link(self):
        tenant = self.make_claimable(phone_claim_enabled=False)
        self.request_code()
        self.assertEqual(self.verify(self.last_code()).status_code, 200)
        tenant.refresh_from_db()
        self.assertIsNone(tenant.user_id)

    def test_already_linked_tenant_is_not_taken_over(self):
        owner_user = self.make_tenant_user()
        tenant = self.make_claimable(user=owner_user)
        self.request_code()
        self.assertEqual(self.verify(self.last_code()).status_code, 200)
        tenant.refresh_from_db()
        self.assertEqual(tenant.user_id, owner_user.pk)

    def test_phone_links_tenants_of_several_landlords(self):
        ta, tb = self.make_claimable(), self.make_claimable(owner=self.user_b)
        la, lb = self.make_lease(tenant=ta), self.make_lease(owner=self.user_b, tenant=tb)
        self.request_code()
        r = self.verify(self.last_code())
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['access']}")
        ids = {x["id"] for x in client.get("/api/tenant/leases/").json()["results"]}
        self.assertEqual(ids, {la.pk, lb.pk})

    def test_unlinked_tenant_cannot_reclaim_by_phone(self):
        tenant = self.make_claimable()
        self.request_code()
        self.verify(self.last_code())
        self.client.post(f"/api/tenants/{tenant.pk}/unlink/")
        cache.clear()
        self.request_code()
        self.assertEqual(self.verify(self.last_code()).status_code, 200)
        tenant.refresh_from_db()
        self.assertIsNone(tenant.user_id)

    def test_phone_link_revokes_pending_invite(self):
        tenant = self.make_claimable()
        token, _ = self.invite(tenant)
        self.request_code()
        self.verify(self.last_code())
        self.assertEqual(self.anon.get(f"/api/invites/{token}/").status_code, 404)

    def test_landlord_with_same_phone_is_not_logged_in_by_sms(self):
        self.user_a.phone = self.phone
        self.user_a.save()
        self.request_code()
        r = self.verify(self.last_code())
        user = User.objects.get(email="tel998901234567@phone.invalid")
        self.assertEqual(r.status_code, 200)
        self.assertNotEqual(user.pk, self.user_a.pk)

    def test_phone_account_cannot_use_password_login(self):
        self.request_code()
        self.verify(self.last_code())
        user = User.objects.get(phone=self.phone)
        self.assertFalse(user.has_usable_password())


class SmsBackendTests(SimpleTestCase):
    def test_backend_selection(self):
        from .sms import ConsoleSmsBackend, EskizSmsBackend, get_sms_backend

        with override_settings(SMS_BACKEND="console"):
            self.assertIsInstance(get_sms_backend(), ConsoleSmsBackend)
        with override_settings(SMS_BACKEND="eskiz"):
            self.assertIsInstance(get_sms_backend(), EskizSmsBackend)
        with override_settings(SMS_BACKEND="portal.sms.LocMemSmsBackend"):
            self.assertIsInstance(get_sms_backend(), LocMemSmsBackend)


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def png(name="check.png", data=PNG):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(name, data, content_type="image/png")


class ReceiptTests(PortalCase):
    def setUp(self):
        import shutil
        import tempfile

        super().setUp()
        self._media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self._media, ignore_errors=True)
        self._override = override_settings(MEDIA_ROOT=self._media)
        self._override.enable()
        self.addCleanup(self._override.disable)
        self.tenant = self.make_tenant()
        self.lease = self.make_lease(tenant=self.tenant)  # платежи 2025 — месяц уже наступил
        self.user = self.make_tenant_user()
        self.accept(self.invite(self.tenant)[0], self.user)
        self.tc = self.client_for(self.user)
        self.payment = self.lease.payments.order_by("due_date").first()

    def send(self, payment=None, **kw):
        data = {"file": png(), **kw}
        return self.tc.post(f"/api/tenant/payments/{(payment or self.payment).pk}/receipts/", data, format="multipart")

    def test_tenant_pay_flow_and_landlord_confirms(self):
        row = next(p for p in self.tc.get("/api/tenant/payments/").json()["results"] if p["id"] == self.payment.pk)
        self.assertEqual((row["can_pay"], row["receipt_status"]), (True, "none"))
        r = self.send()
        self.assertEqual(r.status_code, 201, r.content)
        row = next(p for p in self.tc.get("/api/tenant/payments/").json()["results"] if p["id"] == self.payment.pk)
        self.assertEqual((row["can_pay"], row["receipt_status"]), (False, "pending"))
        self.assertEqual(self.send().status_code, 400)  # второй чек, пока первый на проверке

        # деньги ещё не зачтены
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 0)
        # арендодатель видит чек и сам файл
        self.login(self.user_a)
        items = self.client.get("/api/receipts/?status=pending").json()["results"]
        self.assertEqual([i["payment"] for i in items], [self.payment.pk])
        self.assertEqual(items[0]["tenant_name"], self.tenant.full_name)
        f = self.client.get(f"/api/receipts/{items[0]['id']}/file/")
        self.assertEqual((f.status_code, f["Content-Type"]), (200, "image/png"))
        self.assertEqual(b"".join(f.streaming_content), PNG)

        r = self.client.post(f"/api/receipts/{items[0]['id']}/confirm/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "confirmed")
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, self.payment.amount_due)
        self.assertEqual(self.client.post(f"/api/receipts/{items[0]['id']}/confirm/").status_code, 400)
        actions = set(AuditLog.objects.values_list("action", flat=True))
        self.assertTrue({"receipt.submitted", "receipt.confirmed", "payment.paid"} <= actions)
        row = next(p for p in self.tc.get("/api/tenant/payments/").json()["results"] if p["id"] == self.payment.pk)
        self.assertEqual((row["status"], row["can_pay"], row["receipt_status"]), ("paid", False, "confirmed"))

    def test_reject_allows_resubmit(self):
        rid = self.send(amount=1000).json()["id"]
        self.login(self.user_a)
        r = self.client.post(f"/api/receipts/{rid}/reject/", {"reason": "Нечитаемый чек"}, format="json")
        self.assertEqual(r.json()["status"], "rejected")
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 0)
        row = next(p for p in self.tc.get("/api/tenant/payments/").json()["results"] if p["id"] == self.payment.pk)
        self.assertEqual((row["receipt_status"], row["receipt_reject_reason"], row["can_pay"]),
                         ("rejected", "Нечитаемый чек", True))
        self.assertEqual(self.send().status_code, 201)

    def test_partial_amount_and_confirm_override(self):
        rid = self.send(amount=1000).json()["id"]
        self.login(self.user_a)
        r = self.client.post(f"/api/receipts/{rid}/confirm/", {"amount": 500}, format="json")
        self.assertEqual(r.status_code, 200)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 500)
        self.assertEqual(self.client.post(f"/api/receipts/{rid}/confirm/", format="json").status_code, 400)

    def test_validation(self):
        self.assertEqual(self.send(amount=0).status_code, 400)
        self.assertEqual(self.send(amount=self.payment.amount_due + 1).status_code, 400)
        from django.core.files.uploadedfile import SimpleUploadedFile

        evil = SimpleUploadedFile("x.png", b"<?php echo 1;", content_type="image/png")
        r = self.tc.post(f"/api/tenant/payments/{self.payment.pk}/receipts/", {"file": evil}, format="multipart")
        self.assertEqual(r.status_code, 400)

    def test_future_month_not_payable(self):
        from datetime import date

        today = timezone.localdate()
        future = self.make_lease(prop=self.make_property(name="Будущий"), tenant=self.tenant,
                                 start=date(today.year + 1, 1, 1), end=date(today.year + 1, 6, 1))
        p = future.payments.first()
        row = next(x for x in self.tc.get("/api/tenant/payments/").json()["results"] if x["id"] == p.pk)
        self.assertFalse(row["can_pay"])
        self.assertEqual(self.send(payment=p).status_code, 400)

    def test_isolation(self):
        other_tenant = self.make_tenant(name="Чужой")
        other = self.make_lease(prop=self.make_property(name="Другой"), tenant=other_tenant).payments.first()
        self.assertEqual(self.send(payment=other).status_code, 404)  # чужой платёж жильца
        rid = self.send().json()["id"]
        self.login(self.user_b)
        self.assertEqual(self.client.get("/api/receipts/").json()["count"], 0)
        for url in (f"/api/receipts/{rid}/", f"/api/receipts/{rid}/file/"):
            self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.post(f"/api/receipts/{rid}/confirm/").status_code, 404)
        # жилец не управляет чеками и не ходит в landlord-эндпоинты
        for url in (f"/api/receipts/{rid}/confirm/", f"/api/receipts/{rid}/reject/"):
            self.assertEqual(self.tc.post(url).status_code, 403)
        self.assertEqual(self.tc.get("/api/receipts/").status_code, 403)
        # арендодатель не отправляет чеки
        self.login(self.user_a)
        self.assertEqual(self.client.post(f"/api/tenant/payments/{self.payment.pk}/receipts/",
                                          {"file": png()}, format="multipart").status_code, 403)

    def test_unlinked_tenant_cannot_send(self):
        self.login(self.user_a)
        self.client.post(f"/api/tenants/{self.tenant.pk}/unlink/")
        self.assertEqual(self.send().status_code, 404)


MP4 = b"\x00\x00\x00\x18ftypisom" + b"0" * 64


def media_file(name, data, content_type):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(name, data, content_type=content_type)


class LeaseMediaTests(PortalCase):
    """Фото/видео состояния квартиры: арендодатель загружает, жилец получает уведомление."""

    def setUp(self):
        import shutil
        import tempfile

        super().setUp()
        self._media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self._media, ignore_errors=True)
        self._override = override_settings(MEDIA_ROOT=self._media)
        self._override.enable()
        self.addCleanup(self._override.disable)
        self.tenant = self.make_tenant()
        self.lease = self.make_lease(tenant=self.tenant)
        self.user = self.make_tenant_user()
        self.accept(self.invite(self.tenant)[0], self.user)
        self.tc = self.client_for(self.user)
        self.login(self.user_a)

    def upload(self, file=None, lease=None):
        return self.client.post(
            "/api/lease-media/", {"lease": (lease or self.lease).pk, "file": file or png("flat.png")}, format="multipart"
        )

    def notifications(self):
        return self.tc.get("/api/tenant/notifications/").json()["results"]

    def test_add_photo_and_video_notifies_tenant_once(self):
        r = self.upload()
        self.assertEqual((r.status_code, r.json()["kind"]), (201, "photo"), r.content)
        r = self.upload(media_file("tour.mp4", MP4, "video/mp4"))
        self.assertEqual((r.status_code, r.json()["kind"]), (201, "video"), r.content)
        notes = self.notifications()
        self.assertEqual(len(notes), 1)  # серия загрузок схлопнута в одно уведомление
        self.assertEqual((notes[0]["kind"], notes[0]["count"], notes[0]["is_read"]), ("media_added", 2, False))
        self.assertEqual(self.tc.post("/api/tenant/notifications/read/").status_code, 200)
        self.assertTrue(self.notifications()[0]["is_read"])
        self.upload()  # после прочтения — новое уведомление
        self.assertEqual(len(self.notifications()), 2)

    def test_replace_and_delete_notify_as_changed(self):
        item = self.upload().json()
        self.tc.post("/api/tenant/notifications/read/")
        r = self.client.post(f"/api/lease-media/{item['id']}/replace/",
                             {"file": png("new.png", PNG + b"1")}, format="multipart")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.notifications()[0]["kind"], "media_changed")
        self.tc.post("/api/tenant/notifications/read/")
        self.assertEqual(self.client.delete(f"/api/lease-media/{item['id']}/").status_code, 204)
        self.assertEqual(self.notifications()[0]["kind"], "media_changed")
        self.assertFalse(self.notifications()[0]["is_read"])

    def test_tenant_sees_media_and_file(self):
        item = self.upload().json()
        listed = self.tc.get(f"/api/tenant/media/?lease={self.lease.pk}").json()["results"]
        self.assertEqual([m["id"] for m in listed], [item["id"]])
        f = self.tc.get(f"/api/tenant/media/{item['id']}/file/")
        self.assertEqual((f.status_code, f["Content-Type"]), (200, "image/png"))
        self.assertEqual(b"".join(f.streaming_content), PNG)

    def test_validation(self):
        bad = self.upload(media_file("x.png", b"not an image at all", "image/png"))
        self.assertEqual(bad.status_code, 400)
        mismatch = self.upload(media_file("x.mp4", PNG, "video/mp4"))
        self.assertEqual(mismatch.status_code, 400)
        self.assertEqual(self.upload(media_file("e.png", b"", "image/png")).status_code, 400)
        with override_settings(LEASE_MEDIA_MAX_FILES=1):
            self.assertEqual(self.upload().status_code, 201)
            self.assertEqual(self.upload().status_code, 400)
        self.assertEqual(self.notifications()[0]["count"], 1)  # неудачные загрузки не уведомляют

    def test_isolation(self):
        other_tenant = self.make_tenant(owner=self.user_b, name="Чужой")
        other_lease = self.make_lease(owner=self.user_b, tenant=other_tenant)
        self.assertEqual(self.upload(lease=other_lease).status_code, 400)  # чужой договор
        mine = self.upload().json()
        # другой арендодатель не видит и не меняет
        self.login(self.user_b)
        self.assertEqual(self.client.get(f"/api/lease-media/{mine['id']}/file/").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/lease-media/{mine['id']}/").status_code, 404)
        # чужой жилец не видит
        stranger = self.make_tenant_user("stranger@example.com")
        self.accept(self.invite(other_tenant, as_user=self.user_b)[0], stranger)
        sc = self.client_for(stranger)
        self.assertEqual(sc.get("/api/tenant/media/").json()["results"], [])
        self.assertEqual(sc.get(f"/api/tenant/media/{mine['id']}/file/").status_code, 404)
        self.assertEqual(sc.get("/api/tenant/notifications/").json()["results"], [])
        # жилец не может загружать (только арендодатель)
        r = self.tc.post("/api/lease-media/", {"lease": self.lease.pk, "file": png()}, format="multipart")
        self.assertEqual(r.status_code, 403)

    def test_unlinked_tenant_gets_no_notification(self):
        from leasing.models import Lease

        from .media import notify_tenant
        from .models import TenantNotification

        lone = self.make_tenant(name="Без аккаунта")  # жилец ещё не принял приглашение
        self.assertIsNone(notify_tenant(Lease(tenant=lone), "media_added"))
        self.assertFalse(TenantNotification.objects.filter(user__isnull=True).exists())
