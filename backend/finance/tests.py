import csv
import io
from datetime import date, timedelta

from django.utils import timezone
from openpyxl import load_workbook

from core.testing import OwnerTestCase
from leasing.models import PaymentTransaction
from leasing.services import apply_payment

from .models import Expense, MeterReading


class AuthTests(OwnerTestCase):
    def test_auth_required(self):
        self.client.force_authenticate(None)
        for url in ("/api/meter-readings/", "/api/expenses/", "/api/reports/summary/", "/api/reports/export/"):
            self.assertEqual(self.client.get(url).status_code, 401, url)


class MeterReadingTests(OwnerTestCase):
    def post(self, prop, day, value, meter="electricity"):
        return self.client.post("/api/meter-readings/", {
            "property": prop.pk, "meter": meter, "reading_date": day, "value": value}, format="json")

    def test_readings_must_not_decrease(self):
        prop = self.make_property()
        self.assertEqual(self.post(prop, "2025-01-01", "100.500").status_code, 201)
        self.assertEqual(self.post(prop, "2025-03-01", "300").status_code, 201)
        low = self.post(prop, "2025-02-01", "50")
        self.assertEqual(low.status_code, 400)
        self.assertIn("value", low.json())
        high = self.post(prop, "2025-02-01", "350")
        self.assertEqual(high.status_code, 400)
        self.assertEqual(self.post(prop, "2025-02-01", "200").status_code, 201)
        self.assertEqual(self.post(prop, "2025-02-01", "201").status_code, 400)  # та же дата
        self.assertEqual(self.post(prop, "2025-02-01", "5", meter="gas").status_code, 201)  # другой счётчик
        self.assertEqual(self.post(prop, "2025-04-01", "-1").status_code, 400)

    def test_cannot_use_foreign_property_and_isolation(self):
        foreign = self.make_property(self.user_b)
        r = self.post(foreign, "2025-01-01", "1")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(MeterReading.objects.count(), 0)
        reading = MeterReading.objects.create(owner=self.user_b, property=foreign, meter="gas",
                                              reading_date=date(2025, 1, 1), value=5)
        self.assertEqual(self.client.get("/api/meter-readings/").json()["count"], 0)
        self.assertEqual(self.client.get(f"/api/meter-readings/{reading.pk}/").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/meter-readings/{reading.pk}/").status_code, 404)

    def test_update_keeps_validation(self):
        prop = self.make_property()
        self.post(prop, "2025-01-01", "100")
        second = self.post(prop, "2025-02-01", "200").json()["id"]
        self.assertEqual(self.client.patch(f"/api/meter-readings/{second}/", {"value": "50"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"/api/meter-readings/{second}/", {"value": "250"}, format="json").status_code, 200)


class ExpenseTests(OwnerTestCase):
    def test_create_validate_isolation(self):
        prop = self.make_property()
        ok = self.client.post("/api/expenses/", {"property": prop.pk, "category": "repair", "amount": 500_000,
                                                 "expense_date": "2025-01-10"}, format="json")
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(Expense.objects.get().owner, self.user_a)
        for bad in ({"amount": 0}, {"amount": -5}, {"amount": "1.5"}, {"category": "nope"}):
            payload = {"property": prop.pk, "category": "repair", "amount": 1, "expense_date": "2025-01-10", **bad}
            self.assertEqual(self.client.post("/api/expenses/", payload, format="json").status_code, 400, bad)
        foreign = self.make_property(self.user_b)
        payload = {"property": foreign.pk, "category": "tax", "amount": 1, "expense_date": "2025-01-10"}
        self.assertEqual(self.client.post("/api/expenses/", payload, format="json").status_code, 400)

    def test_foreign_expense_404(self):
        exp = Expense.objects.create(owner=self.user_b, property=self.make_property(self.user_b), amount=5,
                                     expense_date=date(2025, 1, 1))
        self.assertEqual(self.client.get(f"/api/expenses/{exp.pk}/").status_code, 404)
        self.assertEqual(self.client.patch(f"/api/expenses/{exp.pk}/", {"amount": 9}, format="json").status_code, 404)


class ReportTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        today = timezone.localdate()
        self.today = today
        self.p1 = self.make_property(name="Квартира 1")
        self.p2 = self.make_property(name="=HYPERLINK(1)")
        l1 = self.make_lease(prop=self.p1, start=today - timedelta(days=40), end=today + timedelta(days=60),
                             day=1, rent=1_000_000)
        l2 = self.make_lease(prop=self.p2, tenant=self.make_tenant(name="Пётр"), start=today - timedelta(days=40),
                             end=today + timedelta(days=60), day=1, rent=2_000_000)
        apply_payment(payment_id=l1.payments.first().pk, amount=600_000, provider="manual", external_id="r1")
        apply_payment(payment_id=l2.payments.first().pk, amount=2_000_000, provider="manual", external_id="r2")
        Expense.objects.create(owner=self.user_a, property=self.p1, category="utilities", amount=150_000,
                               expense_date=today)
        Expense.objects.create(owner=self.user_a, property=self.p1, category="repair", amount=100_000,
                               expense_date=today - timedelta(days=200))  # вне периода
        # чужие данные не должны попасть в отчёт
        lb = self.make_lease(owner=self.user_b, rent=9_000_000)
        apply_payment(payment_id=lb.payments.first().pk, amount=9_000_000, provider="manual", external_id="rb")
        self.params = f"?date_from={today - timedelta(days=1)}&date_to={today}"

    def test_summary(self):
        body = self.client.get("/api/reports/summary/" + self.params).json()
        self.assertEqual((body["income"], body["expenses"], body["profit"]), (2_600_000, 150_000, 2_450_000))
        rows = {r["property"]: r for r in body["by_property"]}
        self.assertEqual(rows[self.p1.pk]["profit"], 600_000 - 150_000)
        self.assertEqual(rows[self.p2.pk]["income"], 2_000_000)
        self.assertEqual(body["expenses_by_category"], [{"category": "utilities", "amount": 150_000}])

    def test_property_filter_and_foreign_property(self):
        body = self.client.get(f"/api/reports/summary/{self.params}&property={self.p2.pk}").json()
        self.assertEqual((body["income"], body["expenses"]), (2_000_000, 0))
        foreign = self.make_property(self.user_b)
        self.assertEqual(self.client.get(f"/api/reports/summary/{self.params}&property={foreign.pk}").status_code, 400)

    def test_empty_period_and_default_period(self):
        body = self.client.get("/api/reports/summary/?date_from=2000-01-01&date_to=2000-01-31").json()
        self.assertEqual((body["income"], body["expenses"], body["profit"], body["by_property"]), (0, 0, 0, []))
        self.assertEqual(self.client.get("/api/reports/summary/").status_code, 200)

    def test_invalid_period(self):
        for query in ("?date_from=2025-02-01&date_to=2025-01-01", "?date_from=2020-01-01&date_to=2025-01-01",
                      "?date_from=bad", "?file=pdf"):
            self.assertEqual(self.client.get("/api/reports/summary/" + query).status_code, 400, query)

    def test_refund_in_same_period_nets_out(self):
        PaymentTransaction.objects.filter(external_id="r2").update(
            state=PaymentTransaction.State.REFUNDED, cancelled_at=timezone.now())
        body = self.client.get("/api/reports/summary/" + self.params).json()
        self.assertEqual((body["income"], body["refunds"]), (600_000, 2_000_000))

    def test_refund_in_later_period_is_negative_income_there(self):
        later = timezone.now() + timedelta(days=45)
        PaymentTransaction.objects.filter(external_id="r2").update(
            state=PaymentTransaction.State.REFUNDED, cancelled_at=later)
        first = self.client.get("/api/reports/summary/" + self.params).json()
        self.assertEqual(first["income"], 2_600_000)  # в своём периоде оплата остаётся доходом
        d = timezone.localtime(later).date()
        second = self.client.get(f"/api/reports/summary/?date_from={d - timedelta(days=1)}&date_to={d}").json()
        self.assertEqual((second["income"], second["refunds"]), (-2_000_000, 2_000_000))
        self.assertEqual(second["by_property"][0]["profit"], -2_000_000)

    def test_export_csv_escapes_formulas(self):
        r = self.client.get("/api/reports/export/" + self.params + "&file=csv")
        self.assertEqual(r.status_code, 200)
        self.assertIn("attachment", r["Content-Disposition"])
        text = r.content.decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(text), delimiter=";"))
        self.assertEqual(rows[1], ["Объект", "Доход, сум", "Расходы, сум", "Прибыль, сум"])
        self.assertEqual(rows[-1], ["ИТОГО", "2600000", "150000", "2450000"])
        self.assertIn("'=HYPERLINK(1)", [row[0] for row in rows])
        self.assertNotIn("=HYPERLINK(1)", [row[0] for row in rows])

    def test_export_xlsx(self):
        r = self.client.get("/api/reports/export/" + self.params + "&file=xlsx")
        self.assertEqual(r.status_code, 200)
        ws = load_workbook(io.BytesIO(r.content)).active
        rows = list(ws.iter_rows(values_only=True))
        self.assertEqual(rows[-1], ("ИТОГО", 2_600_000, 150_000, 2_450_000))
        self.assertIn("'=HYPERLINK(1)", [row[0] for row in rows])

    def test_other_owner_sees_only_own(self):
        self.login(self.user_b)
        body = self.client.get("/api/reports/summary/" + self.params).json()
        self.assertEqual(body["income"], 9_000_000)
        self.assertEqual(len(body["by_property"]), 1)
