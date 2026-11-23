from datetime import date, timedelta

from django.test import SimpleTestCase
from django.db import IntegrityError, transaction
from django.utils import timezone

from core.models import AuditLog
from core.testing import OwnerTestCase

from .models import Lease, Payment, PaymentTransaction, Property
from .services import apply_payment, generate_schedule, iter_due_dates
from .tasks import end_expired_leases


class AuthRequiredTests(OwnerTestCase):
    def test_every_endpoint_requires_authentication(self):
        self.client.force_authenticate(None)
        for url in ("/api/properties/", "/api/tenants/", "/api/leases/", "/api/payments/",
                    "/api/dashboard/", "/api/audit/", "/api/me/"):
            self.assertEqual(self.client.get(url).status_code, 401, url)


class ScheduleTests(OwnerTestCase):
    def test_monthly_dates(self):
        dates = list(iter_due_dates(date(2025, 1, 1), date(2025, 4, 1), 5))
        self.assertEqual(dates, [date(2025, 1, 5), date(2025, 2, 5), date(2025, 3, 5)])

    def test_start_after_payment_day_moves_to_next_month(self):
        dates = list(iter_due_dates(date(2025, 1, 31), date(2025, 4, 30), 28))
        self.assertEqual(dates, [date(2025, 2, 28), date(2025, 3, 28), date(2025, 4, 28)])

    def test_leap_year_february(self):
        dates = list(iter_due_dates(date(2024, 2, 1), date(2024, 4, 1), 28))
        self.assertEqual(dates, [date(2024, 2, 28), date(2024, 3, 28)])
        dates = list(iter_due_dates(date(2024, 2, 29), date(2024, 5, 1), 28))
        self.assertEqual(dates, [date(2024, 3, 28), date(2024, 4, 28)])

    def test_year_rollover(self):
        dates = list(iter_due_dates(date(2024, 11, 10), date(2025, 2, 10), 15))
        self.assertEqual(dates, [date(2024, 11, 15), date(2024, 12, 15), date(2025, 1, 15)])

    def test_generation_is_idempotent(self):
        lease = self.make_lease()
        self.assertEqual(Payment.objects.filter(lease=lease).count(), 3)
        self.assertEqual(generate_schedule(lease), 0)
        self.assertEqual(Payment.objects.filter(lease=lease).count(), 3)

    def test_generation_keeps_existing_payments(self):
        lease = self.make_lease()
        first = Payment.objects.filter(lease=lease).first()
        Payment.objects.filter(pk=first.pk).update(amount_paid=1000)
        generate_schedule(lease)
        first.refresh_from_db()
        self.assertEqual(first.amount_paid, 1000)


class DatabaseConstraintTests(OwnerTestCase):
    def test_second_active_lease_on_property_rejected_by_db(self):
        lease = self.make_lease()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Lease.objects.create(
                owner=self.user_a, property=lease.property, tenant=lease.tenant,
                start_date=date(2026, 1, 1), end_date=date(2026, 2, 1), rent_amount=1, payment_day=1,
            )

    def test_ended_lease_does_not_block_new_one(self):
        lease = self.make_lease()
        Lease.objects.filter(pk=lease.pk).update(status="ended")
        Lease.objects.create(
            owner=self.user_a, property=lease.property, tenant=lease.tenant,
            start_date=date(2026, 1, 1), end_date=date(2026, 2, 1), rent_amount=1, payment_day=1,
        )

    def test_bad_dates_and_payment_day_rejected_by_db(self):
        prop, tenant = self.make_property(), self.make_tenant()
        base = dict(owner=self.user_a, property=prop, tenant=tenant, rent_amount=1)
        for extra in (
            dict(start_date=date(2025, 2, 1), end_date=date(2025, 2, 1), payment_day=5),
            dict(start_date=date(2025, 1, 1), end_date=date(2025, 2, 1), payment_day=29),
            dict(start_date=date(2025, 1, 1), end_date=date(2025, 2, 1), payment_day=0),
        ):
            with self.assertRaises(IntegrityError), transaction.atomic():
                Lease.objects.create(**base, **extra)

    def test_duplicate_payment_for_same_due_date_rejected(self):
        lease = self.make_lease()
        p = Payment.objects.filter(lease=lease).first()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Payment.objects.create(owner=self.user_a, lease=lease, due_date=p.due_date, amount_due=1)


class TenantIsolationTests(OwnerTestCase):
    def test_lists_show_only_own_objects(self):
        self.make_property(name="Моя")
        self.make_property(self.user_b, name="Чужая")
        body = self.client.get("/api/properties/").json()
        self.assertEqual([p["name"] for p in body["results"]], ["Моя"])

    def test_foreign_object_is_404_not_403(self):
        foreign = self.make_property(self.user_b)
        url = f"/api/properties/{foreign.pk}/"
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.patch(url, {"name": "x"}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(url).status_code, 404)
        foreign.refresh_from_db()
        self.assertEqual(foreign.name, "Квартира 1")

    def test_owner_in_body_is_ignored(self):
        resp = self.client.post(
            "/api/properties/", {"name": "N", "address": "A", "owner": self.user_b.pk}, format="json"
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(Property.objects.get(pk=resp.json()["id"]).owner, self.user_a)

    def test_cannot_create_lease_with_foreign_property_or_tenant(self):
        mine_p, mine_t = self.make_property(), self.make_tenant()
        other_p, other_t = self.make_property(self.user_b), self.make_tenant(self.user_b)
        payload = dict(start_date="2025-01-01", end_date="2025-04-01", rent_amount=100, payment_day=5)
        r = self.client.post("/api/leases/", {**payload, "property": other_p.pk, "tenant": mine_t.pk}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("property", r.json())
        r = self.client.post("/api/leases/", {**payload, "property": mine_p.pk, "tenant": other_t.pk}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("tenant", r.json())
        self.assertEqual(Lease.objects.count(), 0)

    def test_foreign_lease_and_payment_actions_404(self):
        lease_b = self.make_lease(owner=self.user_b)
        pay_b = lease_b.payments.first()
        self.assertEqual(self.client.get(f"/api/leases/{lease_b.pk}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/leases/{lease_b.pk}/end/").status_code, 404)
        self.assertEqual(
            self.client.post(f"/api/leases/{lease_b.pk}/extend/", {"end_date": "2030-01-01"}, format="json").status_code, 404
        )
        self.assertEqual(self.client.get(f"/api/payments/{pay_b.pk}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/payments/{pay_b.pk}/pay/", {"amount": 1}, format="json").status_code, 404)
        self.assertEqual(self.client.get("/api/payments/").json()["count"], 0)
        pay_b.refresh_from_db()
        self.assertEqual(pay_b.amount_paid, 0)

    def test_dashboard_and_audit_are_per_owner(self):
        self.make_lease(owner=self.user_b)
        self.assertEqual(self.client.get("/api/dashboard/").json()["properties"]["total"], 0)
        self.assertEqual(self.client.get("/api/audit/").json()["count"], 0)

    def test_tenant_link_code_requires_ownership(self):
        t = self.make_tenant(self.user_b)
        self.assertEqual(self.client.post(f"/api/tenants/{t.pk}/link-code/").status_code, 404)


class PropertyApiTests(OwnerTestCase):
    def test_validation_errors_are_in_field_format_in_russian(self):
        r = self.client.post("/api/properties/", {"address": "x", "area_m2": "-5"}, format="json")
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertIsInstance(body["name"], list)
        self.assertIn("area_m2", body)

    def test_pagination(self):
        for i in range(25):
            self.make_property(name=f"P{i:02d}")
        body = self.client.get("/api/properties/").json()
        self.assertEqual(body["count"], 25)
        self.assertEqual(len(body["results"]), 20)
        self.assertEqual(len(self.client.get("/api/properties/?page_size=500").json()["results"]), 25)

    def test_cannot_delete_property_with_leases(self):
        lease = self.make_lease()
        r = self.client.delete(f"/api/properties/{lease.property_id}/")
        self.assertEqual(r.status_code, 400)
        self.assertTrue(Lease.objects.filter(pk=lease.pk).exists())

    def test_delete_is_audited(self):
        p = self.make_property()
        self.assertEqual(self.client.delete(f"/api/properties/{p.pk}/").status_code, 204)
        self.assertTrue(AuditLog.objects.filter(owner=self.user_a, action="property.deleted", object_id=p.pk).exists())

    def test_no_n_plus_one(self):
        for i in range(5):
            self.make_lease(prop=self.make_property(name=f"P{i}"), tenant=self.make_tenant(name=f"T{i}"))
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(self.client.get("/api/payments/").status_code, 200)
        baseline = len(ctx)
        for i in range(5, 10):
            self.make_lease(prop=self.make_property(name=f"P{i}"), tenant=self.make_tenant(name=f"T{i}"))
        with CaptureQueriesContext(connection) as ctx:
            self.client.get("/api/payments/")
        self.assertEqual(len(ctx), baseline)
        with CaptureQueriesContext(connection) as ctx:
            self.client.get("/api/leases/")
        self.assertLessEqual(len(ctx), 3)


class LeaseApiTests(OwnerTestCase):
    def payload(self, **kw):
        base = dict(property=self.make_property().pk, tenant=self.make_tenant().pk,
                    start_date="2025-01-01", end_date="2025-04-01", rent_amount=3000000,
                    deposit_amount=1000000, payment_day=5)
        base.update(kw)
        return base

    def test_create_generates_schedule_and_audit(self):
        r = self.client.post("/api/leases/", self.payload(), format="json")
        self.assertEqual(r.status_code, 201, r.content)
        lease = Lease.objects.get(pk=r.json()["id"])
        self.assertEqual(lease.owner, self.user_a)
        self.assertEqual(lease.status, "active")
        self.assertEqual(list(lease.payments.values_list("due_date", "amount_due")),
                         [(date(2025, 1, 5), 3000000), (date(2025, 2, 5), 3000000), (date(2025, 3, 5), 3000000)])
        self.assertTrue(AuditLog.objects.filter(action="lease.created", object_id=lease.pk).exists())

    def test_second_active_lease_gives_friendly_error(self):
        p = self.payload()
        self.assertEqual(self.client.post("/api/leases/", p, format="json").status_code, 201)
        r = self.client.post("/api/leases/", p, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["property"], ["На этот объект уже есть действующий договор."])

    def test_invalid_input(self):
        for bad, field in (
            ({"payment_day": 29}, "payment_day"), ({"payment_day": 0}, "payment_day"),
            ({"rent_amount": 0}, "rent_amount"), ({"rent_amount": -5}, "rent_amount"),
            ({"end_date": "2025-01-01"}, "end_date"), ({"end_date": "2024-12-01"}, "end_date"),
        ):
            r = self.client.post("/api/leases/", self.payload(**bad), format="json")
            self.assertEqual(r.status_code, 400, bad)
            self.assertIn(field, r.json())
        self.assertEqual(Lease.objects.count(), 0)
        self.assertEqual(Payment.objects.count(), 0)

    def test_money_must_be_integer(self):
        r = self.client.post("/api/leases/", self.payload(rent_amount="100.5"), format="json")
        self.assertEqual(r.status_code, 400)

    def test_status_in_body_is_ignored(self):
        r = self.client.post("/api/leases/", self.payload(status="ended"), format="json")
        self.assertEqual(r.json()["status"], "active")

    def test_locked_fields_cannot_change_but_notes_can(self):
        lease = self.make_lease()
        url = f"/api/leases/{lease.pk}/"
        self.assertEqual(self.client.patch(url, {"rent_amount": 1}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"end_date": "2030-01-01"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(url, {"notes": "ок", "deposit_amount": 5}, format="json").status_code, 200)
        lease.refresh_from_db()
        self.assertEqual((lease.notes, lease.deposit_amount), ("ок", 5))

    def test_extend_creates_missing_payments_only(self):
        lease = self.make_lease()
        Payment.objects.filter(lease=lease).update(amount_paid=0)
        r = self.client.post(f"/api/leases/{lease.pk}/extend/", {"end_date": "2025-06-01"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["payments_created"], 2)
        self.assertEqual(lease.payments.count(), 5)
        self.assertTrue(AuditLog.objects.filter(action="lease.extended", object_id=lease.pk).exists())

    def test_extend_rejects_earlier_date_and_ended_lease(self):
        lease = self.make_lease()
        url = f"/api/leases/{lease.pk}/extend/"
        self.assertEqual(self.client.post(url, {"end_date": "2025-04-01"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"end_date": "2025-01-01"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 400)
        self.client.post(f"/api/leases/{lease.pk}/end/")
        self.assertEqual(self.client.post(url, {"end_date": "2026-01-01"}, format="json").status_code, 400)

    def test_extend_is_safe_to_repeat(self):
        lease = self.make_lease()
        url = f"/api/leases/{lease.pk}/extend/"
        self.client.post(url, {"end_date": "2025-06-01"}, format="json")
        self.assertEqual(self.client.post(url, {"end_date": "2025-06-01"}, format="json").status_code, 400)
        self.assertEqual(lease.payments.count(), 5)

    def test_end_lease_removes_future_unpaid_payments_and_is_audited(self):
        today = timezone.localdate()
        lease = self.make_lease(start=today - timedelta(days=40), end=today + timedelta(days=120), day=1)
        paid_future = lease.payments.filter(due_date__gt=today).first()
        apply_payment(payment_id=paid_future.pk, amount=100, provider="manual", external_id="x1", owner=self.user_a)
        before_future = lease.payments.filter(due_date__gt=today).count()
        r = self.client.post(f"/api/leases/{lease.pk}/end/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "ended")
        self.assertEqual(lease.payments.filter(due_date__gt=today).count(), 1)  # осталась только с оплатой
        self.assertGreater(before_future, 1)
        self.assertTrue(AuditLog.objects.filter(action="lease.ended", object_id=lease.pk, actor=self.user_a).exists())
        self.assertEqual(self.client.post(f"/api/leases/{lease.pk}/end/").status_code, 400)

    def test_end_frees_property_for_new_lease(self):
        lease = self.make_lease()
        self.client.post(f"/api/leases/{lease.pk}/end/")
        r = self.client.post("/api/leases/", self.payload(property=lease.property_id, tenant=lease.tenant_id), format="json")
        self.assertEqual(r.status_code, 201)

    def test_delete_lease_without_payments_ok_with_payments_blocked(self):
        lease = self.make_lease()
        self.assertEqual(self.client.delete(f"/api/leases/{lease.pk}/").status_code, 204)
        lease2 = self.make_lease()
        apply_payment(payment_id=lease2.payments.first().pk, amount=10, provider="manual", external_id="k", owner=self.user_a)
        self.assertEqual(self.client.delete(f"/api/leases/{lease2.pk}/").status_code, 400)

    def test_end_expired_leases_task(self):
        old = self.make_lease(start=date(2020, 1, 1), end=date(2020, 3, 1))
        fresh = self.make_lease(start=timezone.localdate(), end=timezone.localdate() + timedelta(days=60))
        self.assertEqual(end_expired_leases(), 1)
        old.refresh_from_db(), fresh.refresh_from_db()
        self.assertEqual((old.status, fresh.status), ("ended", "active"))
        self.assertEqual(end_expired_leases(), 0)


class PaymentApiTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.lease = self.make_lease(rent=1_000_000)
        self.payment = self.lease.payments.first()
        self.url = f"/api/payments/{self.payment.pk}/pay/"

    def pay(self, amount, **kw):
        return self.client.post(self.url, {"amount": amount}, format="json", **kw)

    def test_zero_and_negative_amount_rejected(self):
        for amount in (0, -1, "abc", 1.5):
            r = self.pay(amount)
            self.assertEqual(r.status_code, 400, amount)
            self.assertIn("amount", r.json())
        self.assertEqual(PaymentTransaction.objects.count(), 0)

    def test_missing_amount_rejected(self):
        self.assertEqual(self.client.post(self.url, {}, format="json").status_code, 400)

    def test_partial_then_full(self):
        r = self.pay(400_000)
        self.assertEqual((r.status_code, r.json()["status"], r.json()["remaining"]), (200, "partial", 600_000))
        r = self.pay(600_000)
        self.assertEqual((r.json()["status"], r.json()["remaining"]), ("paid", 0))
        self.payment.refresh_from_db()
        self.assertIsNotNone(self.payment.paid_at)

    def test_overpayment_rejected(self):
        self.pay(900_000)
        r = self.pay(100_001)
        self.assertEqual(r.status_code, 400)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 900_000)

    def test_payment_on_paid_payment_rejected(self):
        self.pay(1_000_000)
        self.assertEqual(self.pay(1).status_code, 400)

    def test_idempotency_key_prevents_double_payment(self):
        for _ in range(3):
            r = self.client.post(self.url, {"amount": 300_000, "idempotency_key": "abc"}, format="json")
            self.assertEqual(r.status_code, 200)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 300_000)
        self.assertEqual(self.payment.transactions.count(), 1)

    def test_idempotency_header_and_key_reuse_with_other_amount(self):
        r = self.pay(100, HTTP_IDEMPOTENCY_KEY="k1")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.pay(100, HTTP_IDEMPOTENCY_KEY="k1").status_code, 200)
        self.assertEqual(self.pay(200, HTTP_IDEMPOTENCY_KEY="k1").status_code, 400)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 100)

    def test_other_owner_same_key_does_not_collide(self):
        self.client.post(self.url, {"amount": 10, "idempotency_key": "same"}, format="json")
        lease_b = self.make_lease(owner=self.user_b)
        pay_b = lease_b.payments.first()
        self.login(self.user_b)
        r = self.client.post(f"/api/payments/{pay_b.pk}/pay/", {"amount": 10, "idempotency_key": "same"}, format="json")
        self.assertEqual(r.status_code, 200)
        pay_b.refresh_from_db()
        self.assertEqual(pay_b.amount_paid, 10)

    def test_payment_is_audited(self):
        self.pay(5)
        log = AuditLog.objects.get(action="payment.paid")
        self.assertEqual((log.actor, log.owner, log.object_id, log.details["amount"]),
                         (self.user_a, self.user_a, self.payment.pk, 5))

    def test_status_computation_and_filter(self):
        today = timezone.localdate()
        lease = self.make_lease(start=today - timedelta(days=70), end=today + timedelta(days=60), day=1)
        Payment.objects.filter(lease=lease).delete()
        mk = lambda delta, paid: Payment.objects.create(
            owner=self.user_a, lease=lease, due_date=today + timedelta(days=delta), amount_due=100, amount_paid=paid)
        overdue, partial, paid, pending = mk(-10, 0), mk(-20, 40), mk(-30, 100), mk(5, 0)
        self.assertEqual([p.status for p in (overdue, partial, paid, pending)],
                         ["overdue", "partial", "paid", "pending"])
        for status, expected in (("overdue", overdue), ("partial", partial), ("paid", paid), ("pending", pending)):
            ids = [r["id"] for r in self.client.get(f"/api/payments/?lease={lease.pk}&status={status}").json()["results"]]
            self.assertEqual(ids, [expected.pk], status)
        self.assertEqual(self.client.get("/api/payments/?status=bogus").status_code, 400)

    def test_due_today_is_pending_not_overdue(self):
        today = timezone.localdate()
        p = Payment(due_date=today, amount_due=10, amount_paid=0)
        self.assertEqual(p.status, "pending")

    def test_repeated_gateway_style_call_does_not_duplicate(self):
        tx1, created1 = apply_payment(payment_id=self.payment.pk, amount=50, provider="click", external_id="777")
        tx2, created2 = apply_payment(payment_id=self.payment.pk, amount=50, provider="click", external_id="777")
        self.assertEqual((created1, created2, tx1.pk), (True, False, tx2.pk))
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 50)


class DashboardTests(OwnerTestCase):
    def test_numbers(self):
        today = timezone.localdate()
        self.make_property(name="пустая")
        self.make_property(name="ремонт", is_under_repair=True)
        lease = self.make_lease(start=today.replace(day=1) - timedelta(days=65), end=today + timedelta(days=20), day=1,
                                rent=1000)
        overdue = lease.payments.filter(due_date__lt=today).order_by("due_date")
        self.assertGreaterEqual(overdue.count(), 2)
        first = overdue.first()
        apply_payment(payment_id=first.pk, amount=400, provider="manual", external_id="d1")
        body = self.client.get("/api/dashboard/").json()
        self.assertEqual(body["properties"], {"total": 3, "occupied": 1, "vacant": 1, "under_repair": 1})
        unpaid_past = Payment.objects.filter(lease=lease, due_date__lt=today)
        expected_debt = sum(p.amount_due - p.amount_paid for p in unpaid_past)
        self.assertEqual(body["overdue"]["amount"], expected_debt)
        self.assertEqual(body["overdue"]["count"], unpaid_past.count())
        self.assertEqual(body["leases_expiring_30_days"], 1)
        month = Payment.objects.filter(due_date__year=today.year, due_date__month=today.month)
        self.assertEqual(body["month"]["expected"], sum(p.amount_due for p in month))
        # новые блоки: динамика за 12 месяцев, простой объектов, тариф отсутствует
        self.assertEqual(len(body["months"]), 12)
        self.assertEqual(body["months"][-1]["month"], today.strftime("%Y-%m"))
        self.assertEqual(body["months"][-1]["expected"], sum(p.amount_due for p in month))
        self.assertIn("prev_month", body)
        self.assertEqual(len(body["vacant_properties"]), 1)
        self.assertIsNone(body["plan"])
        self.assertTrue(all(r["total"] >= 2 for r in body["reliability"]))



class PenaltyTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.today = timezone.localdate()

    def payment(self, days_late, rate="0.40", cap="100", paid=0, amount=1_000_000):
        lease = self.make_lease(start=self.today - timedelta(days=120), end=self.today + timedelta(days=120), day=1,
                                penalty_percent_per_day=rate, penalty_cap_percent=cap)
        Payment.objects.filter(lease=lease).delete()
        return Payment.objects.create(owner=self.user_a, lease=lease, amount_due=amount, amount_paid=paid,
                                      due_date=self.today - timedelta(days=days_late))

    def penalty(self, p):
        p = Payment.objects.select_related("lease").get(pk=p.pk)
        return p.penalty

    def test_disabled_by_default(self):
        self.assertEqual(self.penalty(self.payment(10, rate="0")), 0)

    def test_accrues_per_day_and_rounds_down(self):
        self.assertEqual(self.penalty(self.payment(1)), 4_000)
        self.assertEqual(self.penalty(self.payment(10)), 40_000)
        self.assertEqual(self.penalty(self.payment(3, rate="0.33", amount=1_001)), 9)  # 9.9099 -> 9

    def test_not_overdue_or_due_today_has_no_penalty(self):
        self.assertEqual(self.penalty(self.payment(0)), 0)
        self.assertEqual(self.penalty(self.payment(-5)), 0)

    def test_cap(self):
        self.assertEqual(self.penalty(self.payment(1000, rate="1", cap="50")), 500_000)

    def test_based_on_remaining_and_zero_when_paid(self):
        self.assertEqual(self.penalty(self.payment(10, paid=600_000)), 16_000)  # 400_000 * 0.4% * 10
        self.assertEqual(self.penalty(self.payment(10, paid=1_000_000)), 0)

    def test_exposed_in_api_and_lease_validation(self):
        p = self.payment(5)
        body = self.client.get(f"/api/payments/{p.pk}/").json()
        self.assertEqual((body["days_overdue"], body["penalty"]), (5, 20_000))
        prop, tenant = self.make_property(name="X"), self.make_tenant()
        base = dict(property=prop.pk, tenant=tenant.pk, start_date="2030-01-01", end_date="2030-06-01",
                    rent_amount=1000, payment_day=5)
        for bad in ({"penalty_percent_per_day": "11"}, {"penalty_percent_per_day": "-1"},
                    {"penalty_cap_percent": "101"}):
            self.assertEqual(self.client.post("/api/leases/", {**base, **bad}, format="json").status_code, 400, bad)
        ok = self.client.post("/api/leases/", {**base, "penalty_percent_per_day": "0.5"}, format="json")
        self.assertEqual((ok.status_code, ok.json()["penalty_percent_per_day"]), (201, "0.50"))
        # ставку можно менять и после создания договора
        r = self.client.patch(f"/api/leases/{ok.json()['id']}/", {"penalty_percent_per_day": "1"}, format="json")
        self.assertEqual(r.status_code, 200)


class LeasePaymentDetailsTests(SimpleTestCase):
    """Реквизиты договора имеют приоритет над общими реквизитами арендодателя."""

    def test_fallback_and_override(self):
        from users.models import User
        lease = Lease(owner=User(payment_details="общие"), payment_details="")
        self.assertEqual(lease.get_payment_details(), "общие")
        lease.payment_details = " Карта 8600 "
        self.assertEqual(lease.get_payment_details(), "Карта 8600")
