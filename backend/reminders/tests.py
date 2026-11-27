from datetime import date, timedelta

from django.test import override_settings
from django.utils import timezone

from core.testing import OwnerTestCase
from leasing.services import apply_payment

from .bot_logic import balance_text, link, pay_info_text
from .models import NotificationLog
from .services import run_daily_reminders, tenant_kind
from .tasks import send_daily_reminders


class RecordingSender:
    """Подставной канал связи (граница с внешним миром); вся логика напоминаний — настоящая."""

    sent = []
    fail = False

    markups = []

    def send(self, chat_id, text, reply_markup=None):
        if RecordingSender.fail:
            raise RuntimeError("канал недоступен")
        RecordingSender.sent.append((chat_id, text))
        RecordingSender.markups.append(reply_markup)


class ReminderTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        RecordingSender.sent, RecordingSender.fail = [], False
        self.sender = RecordingSender()
        self.today = timezone.localdate()
        self.user_a.telegram_chat_id = 111
        self.user_a.save()
        self.tenant = self.make_tenant(telegram_chat_id=500)

    def lease_with_due(self, days_from_today, **kw):
        due = self.today + timedelta(days=days_from_today)
        start = due - timedelta(days=5)
        # payment_day подбираем так, чтобы первая оплата пришлась ровно на нужную дату
        return self.make_lease(
            tenant=kw.pop("tenant", self.tenant), start=start, end=due + timedelta(days=1),
            day=due.day if due.day <= 28 else 28, **kw,
        ), due

    def test_kinds(self):
        self.assertEqual(tenant_kind(3), "tenant_before")
        self.assertEqual(tenant_kind(0), "tenant_due")
        self.assertEqual(tenant_kind(-1), "tenant_overdue")
        self.assertIsNone(tenant_kind(-2))
        self.assertEqual(tenant_kind(-4), "tenant_overdue")
        self.assertIsNone(tenant_kind(2))
        self.assertIsNone(tenant_kind(1))

    def test_three_days_before_due_overdue(self):
        for offset, expected in ((3, "tenant_before"), (0, "tenant_due"), (-1, "tenant_overdue")):
            RecordingSender.sent.clear()
            NotificationLog.objects.all().delete()
            from leasing.models import Lease, Payment
            Payment.objects.all().delete(), Lease.objects.all().delete()
            day = min(self.today.day, 28)
            lease = self.make_lease(tenant=self.tenant, prop=self.make_property(name=f"P{offset}"),
                                    start=self.today - timedelta(days=60), end=self.today + timedelta(days=60), day=day)
            Payment.objects.filter(lease=lease).delete()
            Payment.objects.create(owner=self.user_a, lease=lease, amount_due=2_000_000,
                                   due_date=self.today + timedelta(days=offset))
            stats = run_daily_reminders(self.today, self.sender)
            self.assertEqual(stats["tenant_sent"], 1, expected)
            self.assertEqual(NotificationLog.objects.filter(kind=expected, status="sent").count(), 1)
            chat_ids = [c for c, _ in RecordingSender.sent]
            self.assertIn(500, chat_ids)
            self.assertIn(111, chat_ids)  # сводка владельцу
            tenant_text = next(txt for c, txt in RecordingSender.sent if c == 500)
            self.assertIn("2 000 000", tenant_text)

    def _single_payment(self, offset, **kw):
        from leasing.models import Payment
        lease = self.make_lease(tenant=self.tenant, start=self.today - timedelta(days=60),
                                end=self.today + timedelta(days=60), day=min(self.today.day, 28))
        Payment.objects.filter(lease=lease).delete()
        return Payment.objects.create(owner=self.user_a, lease=lease, amount_due=1000,
                                      due_date=self.today + timedelta(days=offset), **kw)

    def test_no_duplicate_on_second_run(self):
        self._single_payment(0)
        run_daily_reminders(self.today, self.sender)
        sent_first = len(RecordingSender.sent)
        stats = run_daily_reminders(self.today, self.sender)
        self.assertEqual(stats, {"tenant_sent": 0, "owner_sent": 0})
        self.assertEqual(len(RecordingSender.sent), sent_first)
        self.assertEqual(NotificationLog.objects.count(), 2)

    def test_paid_payment_gets_no_reminder(self):
        p = self._single_payment(0)
        apply_payment(payment_id=p.pk, amount=1000, provider="manual", external_id="z")
        self.assertEqual(run_daily_reminders(self.today, self.sender), {"tenant_sent": 0, "owner_sent": 0})
        self.assertEqual(RecordingSender.sent, [])

    def test_partial_payment_reminds_about_remainder(self):
        p = self._single_payment(0)
        apply_payment(payment_id=p.pk, amount=400, provider="manual", external_id="z")
        run_daily_reminders(self.today, self.sender)
        self.assertIn("600", next(txt for c, txt in RecordingSender.sent if c == 500))

    def test_tenant_without_telegram_is_skipped_but_owner_informed(self):
        self.tenant.telegram_chat_id = None
        self.tenant.save()
        self._single_payment(0)
        with override_settings(REMINDER_SMS_FALLBACK=False):
            stats = run_daily_reminders(self.today, self.sender)
        self.assertEqual(stats, {"tenant_sent": 0, "owner_sent": 1})
        self.assertIn("нет Telegram", RecordingSender.sent[0][1])

    def test_failed_send_is_logged_and_retried_once_channel_recovers(self):
        self._single_payment(0)
        RecordingSender.fail = True
        stats = run_daily_reminders(self.today, self.sender)
        self.assertEqual(stats, {"tenant_sent": 0, "owner_sent": 0})
        self.assertEqual(NotificationLog.objects.filter(status="failed").count(), 2)
        RecordingSender.fail = False
        stats = run_daily_reminders(self.today, self.sender)
        self.assertEqual(stats, {"tenant_sent": 1, "owner_sent": 1})
        self.assertEqual(NotificationLog.objects.filter(status="sent").count(), 2)
        self.assertEqual(NotificationLog.objects.count(), 2)

    def test_uzbek_template(self):
        self.tenant.language = "uz"
        self.tenant.save()
        self._single_payment(0)
        run_daily_reminders(self.today, self.sender)
        self.assertIn("to'lov kuni", next(txt for c, txt in RecordingSender.sent if c == 500))

    def test_ended_lease_gets_no_reminders(self):
        p = self._single_payment(0)
        p.lease.status = "ended"
        p.lease.save()
        self.assertEqual(run_daily_reminders(self.today, self.sender), {"tenant_sent": 0, "owner_sent": 0})

    def test_celery_task_uses_configured_sender(self):
        self._single_payment(0)
        with override_settings(TELEGRAM_SENDER="reminders.tests.RecordingSender"):
            stats = send_daily_reminders.apply().get()
        self.assertEqual(stats, {"tenant_sent": 1, "owner_sent": 1})

    def test_missing_token_marks_failed_not_crash(self):
        self._single_payment(0)
        with override_settings(TELEGRAM_BOT_TOKEN=""):
            stats = run_daily_reminders(self.today)  # настоящий TelegramSender без токена
        self.assertEqual(stats, {"tenant_sent": 0, "owner_sent": 0})
        self.assertTrue(NotificationLog.objects.filter(status="failed", error__contains="TELEGRAM_BOT_TOKEN").exists())


class BotLogicTests(OwnerTestCase):
    def test_link_tenant_by_code(self):
        tenant = self.make_tenant()
        code = self.client.post(f"/api/tenants/{tenant.pk}/link-code/").json()["code"]
        self.assertTrue(code.startswith("T"))
        self.assertIn("привязан", link(code.lower(), 777))
        tenant.refresh_from_db()
        self.assertEqual((tenant.telegram_chat_id, tenant.link_code), (777, None))
        self.assertIn("не найден", link(code, 888))  # одноразовый

    def test_unknown_expired_and_empty_codes(self):
        tenant = self.make_tenant()
        tenant.link_code, tenant.link_code_expires_at = "TEXPIRED", timezone.now() - timedelta(hours=1)
        tenant.save()
        self.assertIn("не найден", link("TEXPIRED", 1))
        self.assertIn("не найден", link("XYZ", 1))
        self.assertIn("привяжите", link("", 1))

    def test_link_owner(self):
        code = self.client.post("/api/me/telegram-link/").json()["code"]
        self.assertIn("владельца", link(code, 4242))
        self.user_a.refresh_from_db()
        self.assertEqual(self.user_a.telegram_chat_id, 4242)

    def test_owner_cannot_take_chat_of_another_owner(self):
        self.user_b.telegram_chat_id = 4242
        self.user_b.save()
        code = self.client.post("/api/me/telegram-link/").json()["code"]
        self.assertIn("уже привязан", link(code, 4242))

    def test_balance_and_pay_info(self):
        today = timezone.localdate()
        tenant = self.make_tenant(telegram_chat_id=900)
        self.user_a.payment_details = "Карта 8600 1234 5678 9012"
        self.user_a.save()
        lease = self.make_lease(tenant=tenant, start=today - timedelta(days=70), end=today + timedelta(days=60),
                                day=1, rent=1_000_000)
        self.assertIn("Просрочено", balance_text(900))
        self.assertIn("Ближайший платёж", balance_text(900))
        info = pay_info_text(900)
        self.assertIn("8600 1234 5678 9012", info)
        self.assertIn("К оплате сейчас: 1 000 000", info)
        self.assertIn("привяжите", balance_text(12345))

    def test_only_own_tenants_data_by_chat(self):
        self.make_lease(tenant=self.make_tenant(telegram_chat_id=900))
        other = self.make_lease(owner=self.user_b, tenant=self.make_tenant(self.user_b, telegram_chat_id=901))
        text = balance_text(900)
        self.assertNotIn(other.property.name + "x", text)
        self.assertIn("Квартира 1", text)

    def test_bot_module_builds_dispatcher(self):
        from .bot import build_dispatcher
        self.assertIsNotNone(build_dispatcher())


class ManualRemindAndOwnerEventTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        RecordingSender.sent, RecordingSender.fail = [], False
        self.sender = RecordingSender()
        self.today = timezone.localdate()
        self.user_a.telegram_chat_id = 111
        self.user_a.save()
        self.tenant = self.make_tenant(telegram_chat_id=500)
    def _overdue_payment(self):
        from leasing.models import Payment
        self.make_lease(tenant=self.tenant, start=self.today - timedelta(days=40), end=self.today + timedelta(days=100), day=1)
        return Payment.objects.filter(owner=self.user_a, due_date__lt=self.today).first()

    def test_remind_sends_once_per_day_and_skips_no_telegram(self):
        from .services import remind_tenants
        payment = self._overdue_payment()
        stats = remind_tenants(self.user_a, [payment.pk], sender=self.sender)
        self.assertEqual((stats["sent"], len(RecordingSender.sent)), (1, 1))
        again = remind_tenants(self.user_a, [payment.pk], sender=self.sender)
        self.assertEqual((again["sent"], again["already"], len(RecordingSender.sent)), (0, 1, 1))
        self.tenant.telegram_chat_id = None
        self.tenant.save()
        NotificationLog.objects.all().delete()
        with override_settings(REMINDER_SMS_FALLBACK=False):
            self.assertEqual(remind_tenants(self.user_a, [payment.pk], sender=self.sender)["no_telegram"], 1)

    def test_remind_endpoint_ignores_foreign_payments(self):
        payment = self._overdue_payment()
        self.login(self.user_b)
        response = self.client.post("/api/payments/remind/", {"ids": [payment.pk]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sum(response.json().values()), 0)

    def test_owner_notified_about_receipt(self):
        from types import SimpleNamespace
        from .services import notify_owner_receipt
        payment = self._overdue_payment()
        receipt = SimpleNamespace(pk=7, owner=self.user_a, payment=payment, amount=1_000_000)
        self.assertTrue(notify_owner_receipt(receipt, sender=self.sender))
        self.assertFalse(notify_owner_receipt(receipt, sender=self.sender))  # дубль не отправляется
        self.assertEqual(RecordingSender.sent[0][0], 111)
        RecordingSender.fail = True
        receipt.pk = 8
        self.assertFalse(notify_owner_receipt(receipt, sender=self.sender))  # сбой канала не пробрасывается


class BotReceiptTests(OwnerTestCase):
    """Чеки через бота: жилец присылает файл, владелец принимает/отклоняет кнопкой."""

    def setUp(self):
        import shutil
        import tempfile

        from portal.tests import TENANT_PASSWORD  # noqa: F401
        from portal.services import create_tenant_user

        super().setUp()
        self._media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self._media, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=self._media)
        override.enable()
        self.addCleanup(override.disable)
        RecordingSender.sent, RecordingSender.markups, RecordingSender.fail = [], [], False
        self.user_a.telegram_chat_id = 111
        self.user_a.save()
        self.tenant = self.make_tenant(telegram_chat_id=900)
        self.tenant.user = create_tenant_user(email="bot-tenant@example.com", password="T3nant-pass-987")
        self.tenant.save()
        self.lease = self.make_lease(tenant=self.tenant)  # платежи в прошлом — месяц уже наступил
        self.payment = self.lease.payments.order_by("due_date").first()

    PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64

    def _submit(self, payment=None, data=None, name="check.png"):
        from .bot_logic import submit_tenant_receipt
        return submit_tenant_receipt(900, (payment or self.payment).pk, data or self.PNG, name)

    def test_receivable_payments_and_submit(self):
        from portal.models import PaymentReceipt
        from .bot_logic import receivable_payments

        _, rows = receivable_payments(900)
        self.assertIn(self.payment.pk, [p.pk for p in rows])
        self.assertIn("Чек отправлен", self._submit())
        receipt = PaymentReceipt.objects.get()
        self.assertEqual((receipt.status, receipt.owner_id), ("pending", self.user_a.pk))
        self.assertNotIn(self.payment.pk, [p.pk for p in receivable_payments(900)[1]])  # уже на проверке
        self.assertIn("Не удалось", self._submit())  # второй чек по тому же платежу

    def test_rejects_wrong_file_type_and_foreign_payment(self):
        self.assertIn("Не удалось", self._submit(data=b"not an image"))
        other = self.make_lease(owner=self.user_b, tenant=self.make_tenant(self.user_b, telegram_chat_id=901))
        foreign = other.payments.first()
        self.assertIn("нет платежей", self._submit(payment=foreign))

    def test_tenant_without_app_account_cannot_send(self):
        from .bot_logic import receivable_payments

        self.tenant.user = None
        self.tenant.save()
        self.assertIsNone(receivable_payments(900)[1])

    def test_owner_confirms_and_tenant_is_notified(self):
        from portal.models import PaymentReceipt
        from .bot_logic import review_receipt

        self._submit()
        receipt = PaymentReceipt.objects.get()
        reply, notices = review_receipt(111, receipt.pk, True)
        self.assertIn("подтверждён", reply)
        self.assertEqual([chat for chat, _ in notices], [900])
        receipt.refresh_from_db()
        self.payment.refresh_from_db()
        self.assertEqual(receipt.status, "confirmed")
        self.assertGreater(self.payment.amount_paid, 0)
        self.assertIn("уже обработан", review_receipt(111, receipt.pk, True)[0])  # повтор безопасен

    def test_owner_rejects(self):
        from portal.models import PaymentReceipt
        from .bot_logic import review_receipt

        self._submit()
        receipt = PaymentReceipt.objects.get()
        self.assertIn("отклонён", review_receipt(111, receipt.pk, False)[0])
        receipt.refresh_from_db()
        self.assertEqual(receipt.status, "rejected")

    def test_foreign_owner_and_tenant_cannot_review(self):
        from portal.models import PaymentReceipt
        from .bot_logic import review_receipt

        self._submit()
        receipt = PaymentReceipt.objects.get()
        self.user_b.telegram_chat_id = 222
        self.user_b.save()
        self.assertIn("уже обработан", review_receipt(222, receipt.pk, True)[0])  # чужой чек не виден
        self.assertIn("только арендодателю", review_receipt(900, receipt.pk, True)[0])
        receipt.refresh_from_db()
        self.assertEqual(receipt.status, "pending")

    def test_owner_notification_carries_buttons(self):
        RecordingSender.sent.clear()
        with override_settings(TELEGRAM_SENDER="reminders.tests.RecordingSender"), \
                self.captureOnCommitCallbacks(execute=True):
            self._submit()
        self.assertEqual(RecordingSender.sent[0][0], 111)
        buttons = RecordingSender.markups[0]["inline_keyboard"][0]
        self.assertEqual([b["callback_data"].split(":")[1] for b in buttons], ["ok", "no"])

    def test_unlink(self):
        from .bot_logic import unlink

        self.assertIn("отвязан", unlink(900))
        self.tenant.refresh_from_db()
        self.assertIsNone(self.tenant.telegram_chat_id)
        self.assertIn("отвязан", unlink(111))
        self.user_a.refresh_from_db()
        self.assertIsNone(self.user_a.telegram_chat_id)


class BotMenuAndDeepLinkTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.user_a.telegram_chat_id = 111
        self.user_a.save()
        self.tenant = self.make_tenant(telegram_chat_id=900)
        self.make_lease(tenant=self.tenant, rent=2_000_000)

    def test_tenant_history_and_lease(self):
        from .bot_logic import history_text, lease_text
        self.assertIn("2 000 000", history_text(900))
        self.assertIn("Договор", lease_text(900) + "Договор")
        self.assertIn("2 000 000", lease_text(900))
        self.assertIn("привяжите", history_text(5))

    def test_owner_debtors_income_and_pending(self):
        from .bot_logic import debtors_text, income_text, pending_receipts
        self.assertIn("Иванов Иван", debtors_text(111))
        self.assertIn("Доходы за", income_text(111))
        self.assertEqual(pending_receipts(111)[1], [])
        self.assertIn("только арендодателю", debtors_text(900))  # жилец не видит должников
        self.assertIsNone(pending_receipts(900)[1])

    @override_settings(TELEGRAM_BOT_USERNAME="test_bot")
    def test_link_code_endpoints_return_bot_url(self):
        r = self.client.post("/api/me/telegram-link/").json()
        self.assertEqual(r["bot_url"], f"https://t.me/test_bot?start={r['code']}")
        r = self.client.post(f"/api/tenants/{self.tenant.pk}/link-code/").json()
        self.assertTrue(r["bot_url"].endswith(f"?start={r['code']}"))
        self.assertIn("привязан", link(r["code"], 4444))  # ссылка и код ведут к одной привязке

    @override_settings(TELEGRAM_BOT_USERNAME="", TELEGRAM_BOT_TOKEN="")
    def test_no_bot_name_means_no_link_but_code_still_works(self):
        r = self.client.post("/api/me/telegram-link/").json()
        self.assertIsNone(r["bot_url"])
        self.assertTrue(r["code"])


class SmsFallbackAndMiniAppAuthTests(OwnerTestCase):
    """Арендатору без Telegram напоминание уходит SMS; вход в мини-приложение проверяет подпись Telegram."""

    def setUp(self):
        super().setUp()
        from portal.sms import LocMemSmsBackend
        LocMemSmsBackend.outbox.clear()
        self.today = date(2026, 6, 15)  # срок платежа — ровно сегодня → напоминание «tenant_due»

    def _debtor_lease(self, **tenant_kw):
        tenant = self.make_tenant(**tenant_kw)
        self.make_lease(tenant=tenant, start=date(2026, 6, 10), end=date(2026, 9, 10), day=15)
        return tenant

    @override_settings(SMS_BACKEND="locmem")
    def test_tenant_without_telegram_gets_sms_once(self):
        from portal.sms import LocMemSmsBackend
        self._debtor_lease()
        run_daily_reminders(today=self.today, sender=RecordingSender())
        first = len(LocMemSmsBackend.outbox)
        run_daily_reminders(today=self.today, sender=RecordingSender())
        self.assertEqual((first > 0, len(LocMemSmsBackend.outbox)), (True, first))  # повтор в тот же день не шлёт
        self.assertTrue(NotificationLog.objects.filter(dedupe_key__startswith="sms:", status="sent").exists())

    @override_settings(SMS_BACKEND="locmem")
    def test_telegram_tenant_gets_no_sms_and_has_buttons(self):
        from portal.sms import LocMemSmsBackend
        RecordingSender.sent, RecordingSender.markups, RecordingSender.fail = [], [], False
        self._debtor_lease(telegram_chat_id=500)
        run_daily_reminders(today=self.today, sender=RecordingSender())
        self.assertEqual(LocMemSmsBackend.outbox, [])
        tenant_markups = [m for (chat, _), m in zip(RecordingSender.sent, RecordingSender.markups) if chat == 500]
        self.assertTrue(tenant_markups and tenant_markups[0]["inline_keyboard"][0][0]["callback_data"].startswith("pp:"))

    @override_settings(SMS_BACKEND="locmem", REMINDER_SMS_FALLBACK=False)
    def test_sms_fallback_can_be_disabled(self):
        from portal.sms import LocMemSmsBackend
        self._debtor_lease()
        run_daily_reminders(today=self.today, sender=RecordingSender())
        self.assertEqual(LocMemSmsBackend.outbox, [])

    def _init_data(self, token, user_id, age=0, tamper=False):
        import hashlib, hmac, json, time
        from urllib.parse import urlencode
        fields = {"auth_date": str(int(time.time()) - age), "query_id": "AAA", "user": json.dumps({"id": user_id})}
        check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
        secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
        fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if tamper:
            fields["user"] = json.dumps({"id": user_id + 1})
        return urlencode(fields)

    @override_settings(TELEGRAM_BOT_TOKEN="123:ABC")
    def test_miniapp_login(self):
        from rest_framework.test import APIClient
        anon = APIClient()
        self.user_a.telegram_chat_id = 777
        self.user_a.save()
        ok = anon.post("/api/auth/telegram/", {"init_data": self._init_data("123:ABC", 777)}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertIn("access", ok.json())
        # чужая подпись, подделанные данные, устаревшие данные, непривязанный чат
        for data in (self._init_data("999:XYZ", 777), self._init_data("123:ABC", 777, tamper=True),
                     self._init_data("123:ABC", 777, age=3 * 86400)):
            self.assertEqual(anon.post("/api/auth/telegram/", {"init_data": data}, format="json").json()["code"],
                             "bad_init_data")
        unlinked = anon.post("/api/auth/telegram/", {"init_data": self._init_data("123:ABC", 4040)}, format="json")
        self.assertEqual(unlinked.json()["code"], "not_linked")

    @override_settings(TELEGRAM_BOT_TOKEN="123:ABC")
    def test_miniapp_login_for_tenant_with_account(self):
        from portal.services import create_tenant_user
        from rest_framework.test import APIClient
        tenant = self.make_tenant()
        tenant.user = create_tenant_user(email="mini@example.com", password="T3nant-pass-987")
        tenant.save()
        cabinet = APIClient()
        cabinet.force_authenticate(tenant.user)
        code = cabinet.post("/api/tenant/telegram-link/").json()["code"]
        self.assertTrue(code.startswith("U"))
        self.assertIn("привязан", link(code, 888))
        r = APIClient().post("/api/auth/telegram/", {"init_data": self._init_data("123:ABC", 888)}, format="json")
        self.assertEqual(r.status_code, 200)

    @override_settings(TELEGRAM_BOT_TOKEN="123:ABC")
    def test_landlord_code_does_not_grant_tenant_login(self):
        """Арендодатель сам отправляет боту код из карточки жильца — входа в аккаунт жильца это не даёт."""
        from portal.services import create_tenant_user
        from rest_framework.test import APIClient
        victim = create_tenant_user(email="victim@example.com", password="T3nant-pass-987")
        own = self.make_tenant(user=victim)
        other = self.make_tenant(owner=self.user_b, user=victim, telegram_chat_id=555, telegram_login=True)
        code = self.client.post(f"/api/tenants/{own.pk}/link-code/").json()["code"]
        self.assertIn("привязан", link(code, 999))  # чат злоумышленника
        own.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual((own.telegram_chat_id, own.telegram_login), (999, False))
        self.assertEqual((other.telegram_chat_id, other.telegram_login), (555, True))  # чужие записи не тронуты
        r = APIClient().post("/api/auth/telegram/", {"init_data": self._init_data("123:ABC", 999)}, format="json")
        self.assertEqual(r.json()["code"], "not_linked")

    @override_settings(TELEGRAM_BOT_TOKEN="123:ABC")
    def test_chat_linked_before_account_does_not_grant_login(self):
        """Чат привязан к записи до приглашения; жилец принял приглашение — входом этот чат не становится."""
        from portal.services import accept_invite, create_invite, create_tenant_user
        from rest_framework.test import APIClient
        tenant = self.make_tenant()
        self.assertIn("привязан", link(self.client.post(f"/api/tenants/{tenant.pk}/link-code/").json()["code"], 999))
        _invite, token = create_invite(tenant_id=tenant.pk, owner=self.user_a, actor=self.user_a)
        accept_invite(token, create_tenant_user(email="new@example.com", password="T3nant-pass-987"))
        tenant.refresh_from_db()
        self.assertFalse(tenant.telegram_login)
        r = APIClient().post("/api/auth/telegram/", {"init_data": self._init_data("123:ABC", 999)}, format="json")
        self.assertEqual(r.json()["code"], "not_linked")

    @override_settings(TELEGRAM_BOT_TOKEN="123:ABC")
    def test_staff_cannot_use_miniapp_login(self):
        from rest_framework.test import APIClient
        self.user_a.telegram_chat_id, self.user_a.is_staff = 778, True
        self.user_a.save()
        r = APIClient().post("/api/auth/telegram/", {"init_data": self._init_data("123:ABC", 778)}, format="json")
        self.assertEqual((r.status_code, r.json()["code"]), (403, "staff_not_allowed"))


class PhoneShareLinkTests(OwnerTestCase):
    """Привязка без кода: жилец делится собственным номером, бот находит его запись."""

    def test_links_tenant_by_verified_phone(self):
        from .bot_logic import link_by_phone
        tenant = self.make_tenant()  # телефон +998900000000
        self.assertIn("привязан", link_by_phone(321, "998 90 000 00 00"))
        tenant.refresh_from_db()
        self.assertEqual(tenant.telegram_chat_id, 321)
        self.assertIn("уже подключён", link_by_phone(321, "+998900000000"))

    def test_unknown_phone_and_busy_rows(self):
        from .bot_logic import link_by_phone
        self.assertIn("не найден", link_by_phone(1, "+998911111111"))
        self.assertIn("не найден", link_by_phone(1, "abc"))
        self.make_tenant(telegram_chat_id=500)
        self.assertIn("не найден", link_by_phone(2, "+998900000000"))  # запись уже у другого чата — не перехватываем

    def test_tenant_with_email_account_must_use_site(self):
        from portal.services import create_tenant_user
        from .bot_logic import link_by_phone
        tenant = self.make_tenant()
        tenant.user = create_tenant_user(email="mail@example.com", password="T3nant-pass-987")
        tenant.save()
        self.assertIn("на сайте", link_by_phone(7, "+998900000000"))
        tenant.refresh_from_db()
        self.assertIsNone(tenant.telegram_chat_id)

    def test_tenant_with_phone_verified_account_links(self):
        from portal.services import create_tenant_user, phone_email
        from .bot_logic import link_by_phone
        tenant = self.make_tenant()
        tenant.user = create_tenant_user(email=phone_email("+998900000000"), password="T3nant-pass-987")
        tenant.save()
        self.assertIn("привязан", link_by_phone(8, "+998900000000"))
        tenant.refresh_from_db()
        self.assertTrue(tenant.telegram_login)  # номер подтверждён и в Telegram, и SMS — чат годится для входа

    def test_phone_link_without_account_is_notifications_only(self):
        from .bot_logic import link_by_phone
        tenant = self.make_tenant()
        link_by_phone(9, "+998900000000")
        tenant.refresh_from_db()
        self.assertEqual((tenant.telegram_chat_id, tenant.telegram_login), (9, False))
