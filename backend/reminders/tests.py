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

    def send(self, chat_id, text):
        if RecordingSender.fail:
            raise RuntimeError("канал недоступен")
        RecordingSender.sent.append((chat_id, text))


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
