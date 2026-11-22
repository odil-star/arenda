import base64
import hashlib
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from core.models import AuditLog
from core.testing import OwnerTestCase
from leasing.models import Payment, PaymentTransaction

PAYME_KEY = "payme-test-key"
CLICK = dict(CLICK_SERVICE_ID="1111", CLICK_MERCHANT_ID="2222", CLICK_SECRET_KEY="click-secret")


def payme_auth(key=PAYME_KEY):
    return "Basic " + base64.b64encode(f"Paycom:{key}".encode()).decode()


@override_settings(PAYME_KEY=PAYME_KEY, PAYME_MERCHANT_ID="merchant", **CLICK)
class PaymeTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(None)  # вебхуки идут без JWT
        self.lease = self.make_lease(rent=1_000_000)
        self.payment = self.lease.payments.first()
        self.seq = 0

    def rpc(self, method, params, key=PAYME_KEY):
        self.seq += 1
        extra = {"HTTP_AUTHORIZATION": payme_auth(key)} if key else {}
        resp = self.client.post("/api/webhooks/payme/", {"id": self.seq, "method": method, "params": params},
                                format="json", **extra)
        self.assertEqual(resp.status_code, 200)
        return resp.json()

    def account(self, **kw):
        return {"payment_id": str(self.payment.pk), **kw}

    def create(self, tx_id="tx1", amount_sum=400_000):
        return self.rpc("CreateTransaction", {"id": tx_id, "time": 1_700_000_000_000,
                                              "amount": amount_sum * 100, "account": self.account()})

    def test_requires_valid_basic_auth(self):
        for key in (None, "wrong"):
            body = self.rpc("CheckPerformTransaction", {"amount": 100, "account": self.account()}, key=key)
            self.assertEqual(body["error"]["code"], -32504)
        self.assertEqual(PaymentTransaction.objects.count(), 0)

    @override_settings(PAYME_KEY="")
    def test_empty_key_never_authorizes(self):
        body = self.rpc("CheckPerformTransaction", {"amount": 100, "account": self.account()}, key="")
        self.assertEqual(body["error"]["code"], -32504)

    def test_check_perform(self):
        ok = self.rpc("CheckPerformTransaction", {"amount": 100_000_000, "account": self.account()})
        self.assertEqual(ok["result"], {"allow": True})
        too_much = self.rpc("CheckPerformTransaction", {"amount": 100_000_100, "account": self.account()})
        self.assertEqual(too_much["error"]["code"], -31001)
        fractional = self.rpc("CheckPerformTransaction", {"amount": 150, "account": self.account()})
        self.assertEqual(fractional["error"]["code"], -31001)
        zero = self.rpc("CheckPerformTransaction", {"amount": 0, "account": self.account()})
        self.assertEqual(zero["error"]["code"], -31001)
        missing = self.rpc("CheckPerformTransaction", {"amount": 100, "account": {"payment_id": "999999"}})
        self.assertEqual(missing["error"]["code"], -31050)
        garbage = self.rpc("CheckPerformTransaction", {"amount": 100, "account": {"payment_id": "abc"}})
        self.assertEqual(garbage["error"]["code"], -31050)

    def test_unknown_method_and_bad_params(self):
        self.assertEqual(self.rpc("Nope", {})["error"]["code"], -32601)
        self.assertEqual(self.rpc("CheckTransaction", "x")["error"]["code"], -32600)

    def test_full_cycle_and_idempotent_perform(self):
        created = self.create()["result"]
        self.assertEqual(created["state"], 1)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 0)  # пока деньги не зачтены
        first = self.rpc("PerformTransaction", {"id": "tx1"})["result"]
        self.assertEqual(first["state"], 2)
        again = self.rpc("PerformTransaction", {"id": "tx1"})["result"]
        self.assertEqual(again, first)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 400_000)
        self.assertEqual(PaymentTransaction.objects.filter(payment=self.payment).count(), 1)
        self.assertEqual(AuditLog.objects.filter(action="payment.paid", details__provider="payme").count(), 1)

    def test_repeated_create_returns_same_transaction(self):
        a, b = self.create()["result"], self.create()["result"]
        self.assertEqual(a, b)
        self.assertEqual(PaymentTransaction.objects.count(), 1)

    def test_second_open_transaction_for_same_payment_rejected(self):
        self.create("tx1")
        self.assertEqual(self.create("tx2")["error"]["code"], -31008)

    def test_create_with_bad_amount(self):
        self.assertEqual(self.create(amount_sum=1_000_001)["error"]["code"], -31001)

    def test_perform_unknown_transaction(self):
        self.assertEqual(self.rpc("PerformTransaction", {"id": "nope"})["error"]["code"], -31003)

    def test_cancel_before_perform(self):
        self.create()
        res = self.rpc("CancelTransaction", {"id": "tx1", "reason": 3})["result"]
        self.assertEqual((res["state"], res["reason"]), (-1, 3))
        self.assertEqual(self.rpc("PerformTransaction", {"id": "tx1"})["error"]["code"], -31008)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 0)

    def test_cancel_after_perform_refunds_once(self):
        self.create()
        self.rpc("PerformTransaction", {"id": "tx1"})
        res = self.rpc("CancelTransaction", {"id": "tx1", "reason": 5})["result"]
        self.assertEqual(res["state"], -2)
        self.rpc("CancelTransaction", {"id": "tx1", "reason": 5})  # повтор
        self.payment.refresh_from_db()
        self.assertEqual((self.payment.amount_paid, self.payment.paid_at), (0, None))
        self.assertTrue(AuditLog.objects.filter(action="payment.refunded").exists())

    def test_timeout_cancels_transaction_persistently(self):
        self.create()
        PaymentTransaction.objects.update(created_at=timezone.now() - timedelta(hours=13))
        self.assertEqual(self.rpc("PerformTransaction", {"id": "tx1"})["error"]["code"], -31008)
        tx = PaymentTransaction.objects.get()
        self.assertEqual((tx.state, tx.reason), (-1, 4))  # отмена сохранилась
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 0)

    def test_perform_fails_if_payment_was_paid_meanwhile(self):
        self.create(amount_sum=600_000)
        Payment.objects.filter(pk=self.payment.pk).update(amount_paid=800_000)
        self.assertEqual(self.rpc("PerformTransaction", {"id": "tx1"})["error"]["code"], -31008)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 800_000)

    def test_check_transaction_and_statement(self):
        self.create()
        self.rpc("PerformTransaction", {"id": "tx1"})
        check = self.rpc("CheckTransaction", {"id": "tx1"})["result"]
        self.assertEqual(check["state"], 2)
        self.assertGreater(check["perform_time"], 0)
        stmt = self.rpc("GetStatement", {"from": 1_699_999_999_999, "to": 1_700_000_000_001})["result"]
        self.assertEqual([t["id"] for t in stmt["transactions"]], ["tx1"])
        self.assertEqual(stmt["transactions"][0]["amount"], 40_000_000)
        empty = self.rpc("GetStatement", {"from": 1, "to": 2})["result"]
        self.assertEqual(empty["transactions"], [])


@override_settings(**CLICK)
class ClickTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(None)
        self.lease = self.make_lease(rent=1_000_000)
        self.payment = self.lease.payments.first()

    def params(self, action, amount="400000.00", trans_id="9001", **kw):
        p = {"click_trans_id": trans_id, "service_id": "1111", "click_paydoc_id": "5",
             "merchant_trans_id": str(self.payment.pk), "amount": amount, "action": str(action),
             "error": "0", "error_note": "Success", "sign_time": "2026-01-01 10:00:00"}
        p.update(kw)
        parts = [p["click_trans_id"], p["service_id"], CLICK["CLICK_SECRET_KEY"], p["merchant_trans_id"]]
        if action == 1:
            parts.append(p.get("merchant_prepare_id", ""))
        parts += [p["amount"], p["action"], p["sign_time"]]
        p.setdefault("sign_string", hashlib.md5("".join(parts).encode()).hexdigest())
        return p

    def post(self, params):
        resp = self.client.post("/api/webhooks/click/", params)  # form-encoded, как у Click
        self.assertEqual(resp.status_code, 200)
        return resp.json()

    def prepare(self, **kw):
        return self.post(self.params(0, **kw))

    def complete(self, prepare_id, **kw):
        return self.post(self.params(1, merchant_prepare_id=str(prepare_id), **kw))

    def test_bad_signature_rejected(self):
        self.assertEqual(self.post(self.params(0, sign_string="deadbeef"))["error"], -1)
        self.assertEqual(self.post(self.params(0, service_id="9999"))["error"], -1)
        self.assertEqual(PaymentTransaction.objects.count(), 0)

    @override_settings(CLICK_SECRET_KEY="")
    def test_empty_secret_never_validates(self):
        self.assertEqual(self.post(self.params(0, sign_string=hashlib.md5(b"").hexdigest()))["error"], -1)

    def test_full_cycle(self):
        prepared = self.prepare()
        self.assertEqual(prepared["error"], 0)
        completed = self.complete(prepared["merchant_prepare_id"])
        self.assertEqual(completed["error"], 0)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 400_000)
        self.assertTrue(AuditLog.objects.filter(action="payment.paid", details__provider="click").exists())

    def test_repeated_complete_does_not_double_credit(self):
        prep_id = self.prepare()["merchant_prepare_id"]
        self.complete(prep_id)
        for _ in range(3):
            self.assertEqual(self.complete(prep_id)["error"], -4)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 400_000)
        self.assertEqual(PaymentTransaction.objects.count(), 1)

    def test_repeated_prepare_is_idempotent(self):
        a, b = self.prepare(), self.prepare()
        self.assertEqual(a["merchant_prepare_id"], b["merchant_prepare_id"])
        self.assertEqual(PaymentTransaction.objects.count(), 1)

    def test_prepare_after_completion_reports_already_paid(self):
        self.complete(self.prepare()["merchant_prepare_id"])
        self.assertEqual(self.prepare()["error"], -4)

    def test_wrong_amounts_and_unknown_order(self):
        self.assertEqual(self.prepare(amount="2000000")["error"], -2)
        self.assertEqual(self.prepare(amount="0")["error"], -8)
        self.assertEqual(self.prepare(amount="10.5", trans_id="2")["error"], -8)
        self.assertEqual(self.post(self.params(0, merchant_trans_id="999999"))["error"], -5)
        prep_id = self.prepare(trans_id="3")["merchant_prepare_id"]
        self.assertEqual(self.complete(prep_id, trans_id="3", amount="500000.00")["error"], -2)

    def test_complete_unknown_prepare_id(self):
        self.assertEqual(self.complete(424242)["error"], -6)
        self.assertEqual(self.complete("abc")["error"], -6)

    def test_paid_payment_cannot_be_prepared(self):
        Payment.objects.filter(pk=self.payment.pk).update(amount_paid=1_000_000)
        self.assertEqual(self.prepare()["error"], -4)

    def test_click_reported_error_cancels(self):
        prep_id = self.prepare()["merchant_prepare_id"]
        self.assertEqual(self.complete(prep_id, error="-5017")["error"], -9)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 0)
        self.assertEqual(self.complete(prep_id)["error"], -9)

    def test_unknown_action(self):
        params = self.params(0)
        params["action"] = "7"
        self.assertEqual(self.post(params)["error"], -3)


@override_settings(PAYME_MERCHANT_ID="merchant", PAYME_KEY=PAYME_KEY, **CLICK)
class InvoiceTests(OwnerTestCase):
    def test_invoice_links(self):
        lease = self.make_lease(rent=500_000)
        payment = lease.payments.first()
        r = self.client.post(f"/api/payments/{payment.pk}/invoice/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["amount"], 500_000)
        encoded = body["payme_url"].rsplit("/", 1)[1]
        self.assertEqual(base64.b64decode(encoded).decode(),
                         f"m=merchant;ac.payment_id={payment.pk};a=50000000")
        self.assertIn(f"transaction_param={payment.pk}", body["click_url"])
        self.assertIn("amount=500000", body["click_url"])

    def test_invoice_partial_overflow_paid_and_foreign(self):
        lease = self.make_lease(rent=500_000)
        payment = lease.payments.first()
        url = f"/api/payments/{payment.pk}/invoice/"
        self.assertEqual(self.client.post(url, {"amount": 100_000}, format="json").json()["amount"], 100_000)
        self.assertEqual(self.client.post(url, {"amount": 500_001}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"amount": 0}, format="json").status_code, 400)
        Payment.objects.filter(pk=payment.pk).update(amount_paid=500_000)
        self.assertEqual(self.client.post(url).status_code, 400)
        foreign = self.make_lease(owner=self.user_b).payments.first()
        self.assertEqual(self.client.post(f"/api/payments/{foreign.pk}/invoice/").status_code, 404)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post("/api/payments/1/invoice/").status_code, 401)

    @override_settings(PAYME_MERCHANT_ID="", CLICK_SERVICE_ID="")
    def test_unconfigured_providers_give_null(self):
        payment = self.make_lease().payments.first()
        body = self.client.post(f"/api/payments/{payment.pk}/invoice/").json()
        self.assertEqual((body["payme_url"], body["click_url"]), (None, None))
