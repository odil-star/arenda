"""VIP: проверка жильца — согласие, обезличенность, расчёт вывода."""
import json
from datetime import datetime, time, timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AuditLog, Plan, Subscription
from core.testing import OwnerTestCase
from portal.services import create_tenant_user

from .models import Payment
from .screening import GRACE_DAYS, MIN_PAYMENTS, reliability


def give(user, tier):
    plan, _ = Plan.objects.get_or_create(name=f"T-{tier}", defaults={"tier": tier})
    Subscription.objects.update_or_create(user=user, defaults={"plan": plan})
    user.refresh_from_db()


def paid(payment, days_after_due):
    """Оплачен целиком через N дней после срока."""
    moment = timezone.make_aware(datetime.combine(payment.due_date + timedelta(days=days_after_due), time(12, 0)))
    Payment.objects.filter(pk=payment.pk).update(amount_paid=payment.amount_due, paid_at=moment)


class ScreeningBase(OwnerTestCase):
    def setUp(self):
        super().setUp()
        give(self.user_a, "vip")
        self.today = timezone.localdate()
        self.resident = create_tenant_user(email="res@example.com", password="Tenant-pass-123")
        self.tenant = self.make_tenant(name="Проверяемый")
        self.tenant.user = self.resident
        self.tenant.save()

    def past_payments(self, owner=None, tenant=None, months=5):
        lease = self.make_lease(owner=owner, tenant=tenant or self.tenant,
                                start=self.today - timedelta(days=30 * months + 10), end=self.today + timedelta(days=60))
        return [p for p in lease.payments.order_by("due_date") if p.due_date < self.today]

    def share(self, value=True):
        profile = self.resident.profile
        profile.share_reliability = value
        profile.save()

    def screen(self, tenant=None):
        return self.client.get(f"/api/tenants/{(tenant or self.tenant).pk}/screening/")


class AccessTests(ScreeningBase):
    def test_vip_only(self):
        give(self.user_a, "prime")
        self.assertEqual(self.screen().status_code, 403)

    def test_not_linked_and_not_shared_return_no_stats(self):
        for p in self.past_payments():
            paid(p, 0)
        self.assertEqual(self.screen().json(), {"status": "not_shared"})  # согласия нет — цифр нет
        loose = self.make_tenant(name="Без аккаунта")
        self.assertEqual(self.screen(loose).json(), {"status": "not_linked"})

    def test_consent_can_be_withdrawn_at_any_time(self):
        for p in self.past_payments():
            paid(p, 0)
        self.share(True)
        self.assertEqual(self.screen().json()["status"], "ok")
        self.share(False)
        self.assertEqual(self.screen().json(), {"status": "not_shared"})

    def test_cannot_screen_someone_elses_tenant(self):
        other = self.make_tenant(owner=self.user_b, name="Чужой")
        self.assertEqual(self.screen(other).status_code, 404)

    def test_check_is_audited(self):
        self.screen()
        self.assertTrue(AuditLog.objects.filter(owner=self.user_a, action="tenant.screening").exists())


class VerdictTests(ScreeningBase):
    def setUp(self):
        super().setUp()
        self.share()

    def test_reliable(self):
        ps = self.past_payments()
        for p in ps:
            paid(p, 1)
        r = self.screen().json()
        self.assertEqual((r["status"], r["verdict"], r["on_time"], r["late"], r["overdue"]), ("ok", "reliable", len(ps), 0, 0))

    def test_grace_period_boundary(self):
        ps = self.past_payments()
        for p in ps:
            paid(p, GRACE_DAYS)
        self.assertEqual(reliability(self.resident)["on_time"], len(ps))
        paid(ps[0], GRACE_DAYS + 1)
        self.assertEqual(reliability(self.resident)["late"], 1)

    def test_current_overdue_is_risky(self):
        ps = self.past_payments()
        for p in ps[:-2]:
            paid(p, 0)
        r = reliability(self.resident)
        self.assertEqual((r["overdue"], r["verdict"]), (2, "risky"))

    def test_one_overdue_among_many_good_is_mostly(self):
        ps = self.past_payments(months=8)
        for p in ps[:-1]:
            paid(p, 0)
        self.assertEqual(reliability(self.resident)["verdict"], "mostly")

    def test_too_little_history(self):
        ps = self.past_payments(months=MIN_PAYMENTS - 1)
        for p in ps:
            paid(p, 0)
        self.assertEqual(reliability(self.resident)["verdict"], "not_enough")

    def test_partial_payment_counts_as_unpaid(self):
        ps = self.past_payments()
        for p in ps:
            paid(p, 0)
        Payment.objects.filter(pk=ps[0].pk).update(amount_paid=ps[0].amount_due - 1)
        self.assertEqual(reliability(self.resident)["overdue"], 1)

    def test_payments_not_yet_due_are_ignored(self):
        for p in self.past_payments():
            paid(p, 0)
        before = reliability(self.resident)["payments"]
        lease = self.make_lease(tenant=self.tenant, start=self.today, end=self.today + timedelta(days=120))
        self.assertTrue(lease.payments.exists())
        self.assertEqual(reliability(self.resident)["payments"], before)


class PrivacyTests(ScreeningBase):
    def test_aggregates_all_landlords_without_exposing_them(self):
        self.share()
        theirs = self.make_tenant(owner=self.user_b, name="Он же у другого")
        theirs.user = self.resident
        theirs.save()
        prop = self.make_property(owner=self.user_b, name="СЕКРЕТНАЯ-КВАРТИРА-Б")
        mine = self.past_payments()
        lease_b = self.make_lease(owner=self.user_b, prop=prop, tenant=theirs,
                                  start=self.today - timedelta(days=100), end=self.today + timedelta(days=30))
        theirs_ps = [p for p in lease_b.payments.all() if p.due_date < self.today]
        for p in mine + theirs_ps:
            paid(p, 0)
        r = self.screen().json()
        self.assertEqual(r["landlords"], 2)
        self.assertEqual(r["payments"], len(mine) + len(theirs_ps))
        blob = json.dumps(r, ensure_ascii=False)
        for leaked in ("СЕКРЕТНАЯ", "b@example.com", "Он же у другого", "Ташкент"):
            self.assertNotIn(leaked, blob)
        self.assertEqual(set(r), {"status", "verdict", "payments", "on_time", "late", "overdue", "leases", "landlords",
                                  "months", "grace_days"})


class TenantConsentTests(ScreeningBase):
    def test_tenant_toggles_consent_in_own_cabinet(self):
        client = APIClient()
        client.force_authenticate(self.resident)
        self.assertFalse(client.get("/api/tenant/me/").json()["share_reliability"])  # по умолчанию выключено
        r = client.patch("/api/tenant/me/", {"share_reliability": True}, format="json")
        self.assertTrue(r.json()["share_reliability"])
        self.resident.profile.refresh_from_db()
        self.assertTrue(self.resident.profile.share_reliability)
        self.assertFalse(client.patch("/api/tenant/me/", {"share_reliability": False}, format="json").json()["share_reliability"])

    def test_owner_cannot_change_tenants_consent(self):
        self.client.patch(f"/api/tenants/{self.tenant.pk}/", {"share_reliability": True}, format="json")
        self.resident.profile.refresh_from_db()
        self.assertFalse(self.resident.profile.share_reliability)
