"""VIP: API-ключ, выгрузки, webhooks."""
import hashlib
import hmac
import json
from datetime import timedelta
from unittest import mock

from django.utils import timezone
from rest_framework.test import APIClient

from leasing.models import PaymentTransaction
from leasing.services import apply_payment

from . import integrations
from .integrations import DeliveryError, UnsafeUrl, issue_api_key, post_event, resolve_public, sign
from .models import ApiKey, Plan, Subscription, Webhook
from .tasks import deliver_webhook
from .testing import OwnerTestCase

PUBLIC = [(2, 1, 6, "", ("93.184.216.34", 443))]


def give(user, tier, paid_until=None):
    plan, _ = Plan.objects.get_or_create(name=f"T-{tier}", defaults={"tier": tier})
    Subscription.objects.update_or_create(user=user, defaults={"plan": plan, "paid_until": paid_until})
    user.refresh_from_db()


def key_client(raw):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Api-Key {raw}")
    return client


class ApiKeyTests(OwnerTestCase):
    def test_free_cannot_issue(self):
        self.assertEqual(self.client.post("/api/integrations/api-key/").status_code, 403)
        self.assertFalse(self.client.get("/api/integrations/").json()["available"])

    def test_key_is_shown_once_and_stored_hashed(self):
        give(self.user_a, "vip")
        r = self.client.post("/api/integrations/api-key/")
        self.assertEqual(r.status_code, 201)
        raw = r.json()["secret"]
        stored = ApiKey.objects.get(user=self.user_a)
        self.assertNotIn(raw, (stored.key_hash, stored.prefix))
        self.assertEqual(stored.key_hash, hashlib.sha256(raw.encode()).hexdigest())
        self.assertNotIn("secret", self.client.get("/api/integrations/").json())

    def test_reissue_invalidates_old_key(self):
        give(self.user_a, "vip")
        _, old = issue_api_key(self.user_a)
        self.client.post("/api/integrations/api-key/")
        self.assertEqual(key_client(old).get("/api/v1/payments/").status_code, 401)


class ExportTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        give(self.user_a, "vip")
        _, self.raw = issue_api_key(self.user_a)
        self.api = key_client(self.raw)
        today = timezone.localdate()
        self.lease = self.make_lease(start=today - timedelta(days=40), end=today + timedelta(days=60), day=5,
                                     tenant=self.make_tenant(name="=cmd|evil", passport="AA1234567"))
        self.other = self.make_lease(owner=self.user_b, start=today - timedelta(days=40), end=today + timedelta(days=60))

    def test_returns_only_own_data(self):
        r = self.api.get("/api/v1/payments/")
        self.assertEqual(r.status_code, 200)
        ids = {x["id"] for x in r.json()["results"]}
        self.assertTrue(ids)
        self.assertTrue(ids.isdisjoint(set(self.other.payments.values_list("pk", flat=True))))

    def test_bad_or_missing_key_rejected(self):
        self.assertEqual(key_client("rk_wrong").get("/api/v1/payments/").status_code, 401)
        self.assertEqual(APIClient().get("/api/v1/payments/").status_code, 401)

    def test_key_cannot_reach_rest_of_api_or_write(self):
        self.assertEqual(self.api.get("/api/properties/").status_code, 401)
        self.assertEqual(self.api.get("/api/me/").status_code, 401)
        self.assertEqual(self.api.post("/api/v1/payments/", {}, format="json").status_code, 403)

    def test_stops_when_vip_lapses(self):
        give(self.user_a, "prime")
        self.assertEqual(self.api.get("/api/v1/payments/").status_code, 403)
        give(self.user_a, "vip", timezone.localdate() - timedelta(days=1))
        self.assertEqual(self.api.get("/api/v1/payments/").status_code, 403)

    def test_works_with_normal_login_too(self):
        self.client.force_authenticate(self.user_a)
        self.assertEqual(self.client.get("/api/v1/payments/").status_code, 200)
        give(self.user_a, "prime")
        self.assertEqual(self.client.get("/api/v1/payments/").status_code, 403)

    def test_tenants_hide_passport(self):
        rows = self.api.get("/api/v1/tenants/").json()["results"]
        self.assertTrue(rows)
        self.assertNotIn("passport", rows[0])
        self.assertNotIn("AA1234567", json.dumps(rows))

    def test_transactions_csv_for_accounting_is_formula_safe(self):
        payment = self.lease.payments.order_by("due_date").first()
        apply_payment(payment_id=payment.pk, amount=1_000_000, provider="manual", external_id="m-1", owner=self.user_a)
        r = self.api.get("/api/v1/transactions/", {"file": "csv"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r["Content-Type"].startswith("text/csv"))
        text = r.content.decode("utf-8-sig")
        lines = text.strip().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertIn("'=cmd|evil", lines[1])  # имя с «=» не станет формулой
        self.assertIn("1000000", lines[1])

    def test_date_filter_and_validation(self):
        far = (timezone.localdate() + timedelta(days=500)).isoformat()
        self.assertEqual(self.api.get("/api/v1/payments/", {"date_from": far}).json()["count"], 0)
        self.assertEqual(self.api.get("/api/v1/payments/", {"date_from": "вчера"}).status_code, 400)


class SsrfTests(OwnerTestCase):
    def check(self, url, addrs):
        infos = [(2, 1, 6, "", (ip, 443)) for ip in addrs]
        with mock.patch("core.integrations.socket.getaddrinfo", return_value=infos):
            return resolve_public(url)

    def test_rejects_non_https_and_credentials(self):
        for url in ("http://example.com/h", "ftp://example.com", "https://u:p@example.com/", "example.com"):
            with self.assertRaises(UnsafeUrl):
                self.check(url, ["93.184.216.34"])

    def test_rejects_private_loopback_linklocal_and_mixed(self):
        for ip in ("127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "172.16.0.1", "::1", "0.0.0.0"):
            with self.assertRaises(UnsafeUrl, msg=ip):
                self.check("https://evil.example/h", [ip])
        with self.assertRaises(UnsafeUrl):  # одно из имён ведёт внутрь — отказ
            self.check("https://evil.example/h", ["93.184.216.34", "10.0.0.1"])

    def test_accepts_public(self):
        self.assertEqual(self.check("https://hooks.example.com:8443/x", ["93.184.216.34"]),
                         ("hooks.example.com", 8443, "93.184.216.34"))

    def test_setup_endpoint_refuses_internal_url(self):
        give(self.user_a, "vip")
        with mock.patch("core.integrations.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            r = self.client.put("/api/integrations/webhook/", {"url": "https://localhost/h"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertFalse(Webhook.objects.exists())


class FakeConn:
    last = None

    def __init__(self, host, port, ip, timeout):
        self.host, self.ip = host, ip
        self.status = 200
        FakeConn.last = self

    def request(self, method, path, body, headers):
        self.method, self.path, self.body, self.headers = method, path, body, headers

    def getresponse(self):
        return mock.Mock(status=self.status)

    def close(self):
        pass


class WebhookTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        give(self.user_a, "vip")
        patcher = mock.patch("core.integrations.socket.getaddrinfo", return_value=PUBLIC)
        patcher.start()
        self.addCleanup(patcher.stop)
        conn = mock.patch("core.integrations._PinnedConnection", FakeConn)
        conn.start()
        self.addCleanup(conn.stop)

    def setup_hook(self):
        r = self.client.put("/api/integrations/webhook/", {"url": "https://hooks.example.com/in?x=1"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_secret_shown_once_on_create(self):
        first = self.setup_hook()
        self.assertTrue(first["secret"])
        again = self.client.put("/api/integrations/webhook/", {"url": "https://hooks.example.com/in"}, format="json").json()
        self.assertNotIn("secret", again)
        self.assertNotIn("secret", self.client.get("/api/integrations/").json()["webhook"])

    def test_signature_is_verifiable_and_connects_to_pinned_ip(self):
        secret = self.setup_hook()["secret"]
        post_event("https://hooks.example.com/in?x=1", secret, "payment.received", "evt1", {"a": 1})
        conn = FakeConn.last
        self.assertEqual((conn.ip, conn.host, conn.path), ("93.184.216.34", "hooks.example.com", "/in?x=1"))
        ts = conn.headers["X-Webhook-Timestamp"]
        expected = "sha256=" + hmac.new(secret.encode(), ts.encode() + b"." + conn.body, hashlib.sha256).hexdigest()
        self.assertEqual(conn.headers["X-Webhook-Signature"], expected)
        self.assertEqual(conn.headers["X-Webhook-Signature"], sign(secret, ts, conn.body))
        self.assertEqual(json.loads(conn.body)["id"], "evt1")

    def test_payment_queues_event_for_vip_only(self):
        self.setup_hook()
        payment = self.make_lease().payments.order_by("due_date").first()
        with mock.patch("core.tasks.deliver_webhook.delay") as delay, self.captureOnCommitCallbacks(execute=True):
            apply_payment(payment_id=payment.pk, amount=500_000, provider="manual", external_id="w-1", owner=self.user_a)
        self.assertEqual(delay.call_count, 1)
        _hook_id, event, _event_id, data = delay.call_args.args
        self.assertEqual((event, data["amount"], data["payment_id"]), ("payment.received", 500_000, payment.pk))
        give(self.user_a, "prime")
        with mock.patch("core.tasks.deliver_webhook.delay") as delay, self.captureOnCommitCallbacks(execute=True):
            apply_payment(payment_id=payment.pk, amount=100_000, provider="manual", external_id="w-2", owner=self.user_a)
        delay.assert_not_called()

    def test_other_owner_payment_does_not_trigger(self):
        self.setup_hook()
        payment = self.make_lease(owner=self.user_b).payments.order_by("due_date").first()
        with mock.patch("core.tasks.deliver_webhook.delay") as delay, self.captureOnCommitCallbacks(execute=True):
            apply_payment(payment_id=payment.pk, amount=100_000, provider="manual", external_id="w-3", owner=self.user_b)
        delay.assert_not_called()

    def test_failures_counted_and_hook_disabled(self):
        self.setup_hook()
        hook = Webhook.objects.get()
        with mock.patch("core.tasks.post_event", side_effect=DeliveryError("Получатель ответил 500")):
            for _ in range(integrations.MAX_FAILURES):
                with self.assertRaises(DeliveryError):
                    deliver_webhook.run(hook.pk, "ping", "e", {})
        hook.refresh_from_db()
        self.assertFalse(hook.is_active)
        self.assertEqual(hook.failures, integrations.MAX_FAILURES)
        self.assertEqual(deliver_webhook.run(hook.pk, "ping", "e", {}), "skipped")

    def test_success_resets_failures(self):
        self.setup_hook()
        Webhook.objects.update(failures=7)
        hook = Webhook.objects.get()
        self.assertEqual(deliver_webhook.run(hook.pk, "ping", "e", {}), 200)
        hook.refresh_from_db()
        self.assertEqual((hook.failures, hook.last_status, hook.last_error), (0, 200, ""))

    def test_test_endpoint_and_rotate(self):
        old = self.setup_hook()["secret"]
        r = self.client.post("/api/integrations/webhook/test/")
        self.assertEqual(r.json(), {"ok": True, "status": 200})
        new = self.client.post("/api/integrations/webhook/rotate-secret/").json()["secret"]
        self.assertNotEqual(old, new)

    def test_free_cannot_configure(self):
        give(self.user_a, "free")
        r = self.client.put("/api/integrations/webhook/", {"url": "https://hooks.example.com/in"}, format="json")
        self.assertEqual(r.status_code, 403)
