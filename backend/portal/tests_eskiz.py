import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings

from .sms import EskizSmsBackend, SmsError


class FakeEskiz(BaseHTTPRequestHandler):
    """Настоящий HTTP-сервер вместо Eskiz: наш клиент ходит по сети как в проде."""

    log = []
    valid_tokens = {"tok-1"}
    issue_token = "tok-1"

    def do_POST(self):
        body = parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode())
        FakeEskiz.log.append((self.path, {k: v[0] for k, v in body.items()}, self.headers.get("Authorization")))
        if self.path == "/api/auth/login":
            if body.get("password") != ["pw"]:
                return self.reply(401, {"message": "bad"})
            return self.reply(200, {"data": {"token": FakeEskiz.issue_token}})
        if self.headers.get("Authorization") not in {f"Bearer {t}" for t in FakeEskiz.valid_tokens}:
            return self.reply(401, {})
        self.reply(200, {"status": "waiting"})

    def reply(self, code, payload):
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class EskizTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.server = HTTPServer(("127.0.0.1", 0), FakeEskiz)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        super().tearDownClass()

    def setUp(self):
        cache.clear()
        FakeEskiz.log, FakeEskiz.valid_tokens, FakeEskiz.issue_token = [], {"tok-1"}, "tok-1"
        self.settings = override_settings(ESKIZ_BASE_URL=self.url, ESKIZ_EMAIL="a@b.uz", ESKIZ_PASSWORD="pw")
        self.settings.enable()

    def tearDown(self):
        self.settings.disable()

    def test_logs_in_once_and_sends(self):
        backend = EskizSmsBackend()
        backend.send("+998901234567", "код 123456")
        backend.send("+998901234567", "ещё")
        paths = [p for p, _, _ in FakeEskiz.log]
        self.assertEqual(paths, ["/api/auth/login", "/api/message/sms/send", "/api/message/sms/send"])
        _, sent, auth = FakeEskiz.log[1]
        self.assertEqual((sent["mobile_phone"], sent["message"], auth), ("998901234567", "код 123456", "Bearer tok-1"))

    def test_expired_token_is_refreshed_once(self):
        cache.set(EskizSmsBackend.CACHE_KEY, "stale", 100)
        EskizSmsBackend().send("+998901234567", "x")
        self.assertEqual([p for p, _, _ in FakeEskiz.log],
                         ["/api/message/sms/send", "/api/auth/login", "/api/message/sms/send"])

    def test_still_unauthorized_raises(self):
        FakeEskiz.valid_tokens = set()
        with self.assertRaises(SmsError):
            EskizSmsBackend().send("+998901234567", "x")

    @override_settings(ESKIZ_PASSWORD="wrong")
    def test_bad_credentials_raise_clear_error(self):
        with self.assertRaisesMessage(SmsError, "неверный логин"):
            EskizSmsBackend().send("+998901234567", "x")

    @override_settings(ESKIZ_EMAIL="", ESKIZ_PASSWORD="")
    def test_missing_credentials(self):
        with self.assertRaisesMessage(SmsError, "не заданы"):
            EskizSmsBackend().send("+998901234567", "x")

    def test_unreachable_server_raises_sms_error(self):
        with override_settings(ESKIZ_BASE_URL="http://127.0.0.1:1"):
            with self.assertRaises(SmsError):
                EskizSmsBackend().send("+998901234567", "x")
