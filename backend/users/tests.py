from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import User


class AuthTests(APITestCase):
    def setUp(self):
        cache.clear()

    def register(self, **kw):
        data = {"email": "owner@example.com", "password": "Str0ng-pass-987", **kw}
        return self.client.post("/api/auth/register/", data, format="json")

    def test_register_login_refresh_me(self):
        r = self.register(first_name="Али")
        self.assertEqual(r.status_code, 201)
        self.assertNotIn("password", r.json())
        tokens = self.client.post(
            "/api/auth/token/", {"email": "OWNER@example.com", "password": "Str0ng-pass-987"}, format="json"
        ).json()
        self.assertIn("access", tokens)
        refreshed = self.client.post("/api/auth/token/refresh/", {"refresh": tokens["refresh"]}, format="json")
        self.assertEqual(refreshed.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        me = self.client.get("/api/me/").json()
        self.assertEqual((me["email"], me["first_name"], me["language"]), ("owner@example.com", "Али", "ru"))
        self.assertFalse(me["telegram_linked"])

    def test_duplicate_email_case_insensitive_and_weak_password(self):
        self.register()
        r = self.register(email="Owner@Example.com")
        self.assertEqual(r.status_code, 400)
        self.assertIn("email", r.json())
        r = self.register(email="x@example.com", password="123")
        self.assertEqual(r.status_code, 400)
        self.assertIn("password", r.json())

    def test_wrong_password_error_format(self):
        self.register()
        r = self.client.post("/api/auth/token/", {"email": "owner@example.com", "password": "nope"}, format="json")
        self.assertEqual(r.status_code, 401)
        self.assertIsInstance(r.json()["detail"], list)

    def test_me_requires_auth_and_patch_cannot_change_email(self):
        self.assertEqual(self.client.get("/api/me/").status_code, 401)
        user = User.objects.create_user("m@example.com", "Str0ng-pass-987")
        self.client.force_authenticate(user)
        r = self.client.patch("/api/me/", {"email": "evil@example.com", "phone": "+998901112233", "is_staff": True}, format="json")
        self.assertEqual(r.status_code, 200)
        user.refresh_from_db()
        self.assertEqual((user.email, user.phone, user.is_staff), ("m@example.com", "+998901112233", False))

    def test_auth_endpoints_are_throttled(self):
        codes = [
            self.client.post("/api/auth/token/", {"email": "a@b.co", "password": "x"}, format="json").status_code
            for _ in range(12)
        ]
        self.assertEqual(codes[:10], [401] * 10)
        self.assertEqual(codes[10:], [429, 429])

    def test_telegram_link_code_for_owner(self):
        user = User.objects.create_user("t@example.com", "Str0ng-pass-987")
        self.client.force_authenticate(user)
        code = self.client.post("/api/me/telegram-link/").json()["code"]
        user.refresh_from_db()
        self.assertEqual(user.telegram_link_code, code)



class PasswordResetTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("reset@example.com", "Old-pass-12345")

    def request_reset(self, email="reset@example.com"):
        from django.core import mail
        mail.outbox.clear()
        r = self.client.post("/api/auth/password-reset/", {"email": email}, format="json")
        self.assertEqual(r.status_code, 200)
        return mail.outbox

    def link_parts(self, outbox):
        import re
        return re.search(r"/reset-password/([^/]+)/(\S+)", outbox[0].body).groups()

    def login(self, password):
        return self.client.post("/api/auth/token/", {"email": "reset@example.com", "password": password},
                                format="json").status_code

    def test_full_flow_and_old_password_stops_working(self):
        uid, token = self.link_parts(self.request_reset())
        r = self.client.post("/api/auth/password-reset/confirm/",
                             {"uid": uid, "token": token, "password": "Brand-new-pass-77"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.login("Old-pass-12345"), 401)
        self.assertEqual(self.login("Brand-new-pass-77"), 200)

    def test_token_is_single_use(self):
        uid, token = self.link_parts(self.request_reset())
        payload = {"uid": uid, "token": token, "password": "Brand-new-pass-77"}
        self.assertEqual(self.client.post("/api/auth/password-reset/confirm/", payload, format="json").status_code, 200)
        again = self.client.post("/api/auth/password-reset/confirm/", {**payload, "password": "Another-pass-88"},
                                 format="json")
        self.assertEqual(again.status_code, 400)
        self.assertIn("token", again.json())

    def test_unknown_email_gets_same_answer_and_no_mail(self):
        self.assertEqual(self.request_reset("nobody@example.com"), [])

    def test_case_insensitive_email(self):
        self.assertEqual(len(self.request_reset("RESET@example.com")), 1)

    def test_bad_token_uid_and_weak_password(self):
        uid, token = self.link_parts(self.request_reset())

        def post(**kw):
            data = {"uid": uid, "token": token, "password": "Brand-new-pass-77", **kw}
            return self.client.post("/api/auth/password-reset/confirm/", data, format="json")

        self.assertEqual(post(token="bad-token").status_code, 400)
        self.assertEqual(post(uid="zzz").status_code, 400)
        weak = post(password="123")
        self.assertEqual(weak.status_code, 400)
        self.assertIn("password", weak.json())
        self.assertEqual(post().status_code, 200)  # слабый пароль токен не сжёг

    def test_inactive_user_gets_no_mail(self):
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.request_reset(), [])

    def test_endpoints_are_throttled(self):
        codes = [self.client.post("/api/auth/password-reset/", {"email": "x@example.com"}, format="json").status_code
                 for _ in range(12)]
        self.assertEqual(codes[-1], 429)


class ProfileTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("p@example.com", "Old-pass-12345")
        self.client.force_authenticate(self.user)

    def test_change_password(self):
        bad = self.client.post("/api/me/password/", {"current_password": "x", "new_password": "New-pass-98765"}, format="json")
        self.assertEqual(bad.status_code, 400)
        weak = self.client.post("/api/me/password/", {"current_password": "Old-pass-12345", "new_password": "123"}, format="json")
        self.assertEqual(weak.status_code, 400)
        ok = self.client.post("/api/me/password/", {"current_password": "Old-pass-12345", "new_password": "New-pass-98765"}, format="json")
        self.assertEqual(ok.status_code, 204)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("New-pass-98765"))

    def test_telegram_link_and_unlink(self):
        code = self.client.post("/api/me/telegram-link/").json()["code"]
        self.assertTrue(code.startswith("O"))
        self.user.telegram_chat_id = 123
        self.user.save()
        self.assertTrue(self.client.get("/api/me/").json()["telegram_linked"])
        self.assertEqual(self.client.delete("/api/me/telegram-link/").status_code, 204)
        self.assertFalse(self.client.get("/api/me/").json()["telegram_linked"])


class RefreshRevocationTests(APITestCase):
    """После смены/сброса пароля ранее выданные refresh-токены перестают работать."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("rev@example.com", "Old-pass-12345")

    def login(self, password="Old-pass-12345"):
        return self.client.post("/api/auth/token/", {"email": "rev@example.com", "password": password},
                                format="json").json()

    def refresh(self, token):
        return self.client.post("/api/auth/token/refresh/", {"refresh": token}, format="json")

    def test_rotated_refresh_cannot_be_reused(self):
        tokens = self.login()
        first = self.refresh(tokens["refresh"])
        self.assertEqual(first.status_code, 200)
        self.assertEqual(self.refresh(tokens["refresh"]).status_code, 401)  # старый уже отозван
        self.assertEqual(self.refresh(first.json()["refresh"]).status_code, 200)

    def test_password_change_revokes_all_refresh_tokens(self):
        a, b = self.login(), self.login()
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + a["access"])
        r = self.client.post("/api/me/password/", {"current_password": "Old-pass-12345",
                                                   "new_password": "New-pass-98765"}, format="json")
        self.assertEqual(r.status_code, 204)
        self.client.credentials()
        self.assertEqual(self.refresh(a["refresh"]).status_code, 401)
        self.assertEqual(self.refresh(b["refresh"]).status_code, 401)
        self.assertIn("refresh", self.login("New-pass-98765"))  # новый вход работает

    def test_password_reset_revokes_refresh_tokens(self):
        import re
        from django.core import mail
        stolen = self.login()
        self.client.post("/api/auth/password-reset/", {"email": "rev@example.com"}, format="json")
        uid, token = re.search(r"/reset-password/([^/]+)/(\S+)", mail.outbox[-1].body).groups()
        r = self.client.post("/api/auth/password-reset/confirm/",
                             {"uid": uid, "token": token, "password": "Brand-new-pass-77"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.refresh(stolen["refresh"]).status_code, 401)
