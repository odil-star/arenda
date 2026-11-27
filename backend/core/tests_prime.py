"""Эксклюзивные возможности Prime: что они дают Prime/VIP и что Free остаётся прежним."""
from datetime import timedelta

from django.core import mail
from django.test import override_settings
from django.utils import timezone

from leasing.models import Payment
from portal.sms import LocMemSmsBackend
from reminders.digest import previous_month, run_monthly_digest
from reminders.models import NotificationLog
from reminders.services import run_daily_reminders
from support.models import SupportMessage, SupportThread
from users.models import User

from .models import Plan, Subscription
from .testing import OwnerTestCase
from .tiers import owner_ids_with_tier


class Recorder:
    def __init__(self):
        self.sent = []

    def send(self, chat_id, text, reply_markup=None):
        self.sent.append((chat_id, text))


def give_tier(user, tier, paid_until=None):
    plan, _ = Plan.objects.get_or_create(name=f"T-{tier}", defaults={"tier": tier})
    Subscription.objects.update_or_create(user=user, defaults={"plan": plan, "paid_until": paid_until})


class TierOwnersTests(OwnerTestCase):
    def test_includes_higher_tiers_and_skips_expired(self):
        give_tier(self.user_a, "vip")
        give_tier(self.user_b, "prime", timezone.localdate() - timedelta(days=1))
        self.assertEqual(owner_ids_with_tier("prime"), {self.user_a.pk})
        self.assertEqual(owner_ids_with_tier("vip"), {self.user_a.pk})


@override_settings(SMS_BACKEND="locmem", REMINDER_SMS_FALLBACK=True)
class SmsDuplicateTests(OwnerTestCase):
    """Prime: напоминание уходит и в Telegram, и SMS; у Free с Telegram — только Telegram."""

    def setUp(self):
        super().setUp()
        LocMemSmsBackend.outbox.clear()
        self.today = timezone.localdate()
        tenant = self.make_tenant(telegram_chat_id=500)
        due = self.today + timedelta(days=3)
        self.make_lease(tenant=tenant, start=due - timedelta(days=5), end=due + timedelta(days=30),
                        day=min(due.day, 28))
        # оставляем один платёж и ставим ему срок «через 3 дня» — тест не зависит от сегодняшней даты
        first = Payment.objects.filter(owner=self.user_a).order_by("due_date").first()
        Payment.objects.filter(owner=self.user_a).exclude(pk=first.pk).delete()
        Payment.objects.filter(pk=first.pk).update(due_date=due)

    def test_free_owner_gets_telegram_only(self):
        sender = Recorder()
        run_daily_reminders(self.today, sender=sender)
        self.assertEqual(len(sender.sent), 1)
        self.assertEqual(LocMemSmsBackend.outbox, [])

    def test_prime_owner_also_gets_sms(self):
        give_tier(self.user_a, "prime")
        sender = Recorder()
        stats = run_daily_reminders(self.today, sender=sender)
        self.assertEqual(len(sender.sent), 1)
        self.assertEqual(len(LocMemSmsBackend.outbox), 1)
        self.assertEqual(stats["tenant_sms"], 1)
        run_daily_reminders(self.today, sender=sender)  # повторный запуск дублей не даёт
        self.assertEqual(len(LocMemSmsBackend.outbox), 1)


class DigestTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.today = timezone.localdate()
        self.first, self.last = previous_month(self.today)
        lease = self.make_lease(start=self.first, end=self.today + timedelta(days=90), day=5)
        Payment.objects.filter(lease=lease, due_date__range=(self.first, self.last)).update(amount_paid=1_000_000)
        self.user_a.telegram_chat_id = 111
        self.user_a.save()

    def test_only_prime_owners_get_digest(self):
        sender = Recorder()
        self.assertEqual(run_monthly_digest(self.today, sender), {"telegram": 0, "email": 0})
        give_tier(self.user_a, "prime")
        self.assertEqual(run_monthly_digest(self.today, sender), {"telegram": 1, "email": 1})
        chat_id, text = sender.sent[0]
        self.assertEqual(chat_id, 111)
        self.assertIn(f"{self.first.month:02d}.{self.first.year}", text)
        self.assertIn("1 000 000", text)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["a@example.com"])

    def test_second_run_does_not_duplicate(self):
        give_tier(self.user_a, "prime")
        sender = Recorder()
        run_monthly_digest(self.today, sender)
        self.assertEqual(run_monthly_digest(self.today, sender), {"telegram": 0, "email": 0})
        self.assertEqual(NotificationLog.objects.filter(dedupe_key__startswith="digest:").count(), 1)


class BoostedListingsTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(None)

    def titles(self, **params):
        return [x["title"] for x in self.client.get("/api/listings/", params).json()["results"]]

    def ad(self, owner, name):
        return self.make_property(owner=owner, name=name, is_listed=True, listing_price=1_000_000)

    def test_prime_ads_first_capped_at_three_per_owner(self):
        for i in range(5):
            self.ad(self.user_b, f"B{i}")  # у Free
        for i in range(5):
            self.ad(self.user_a, f"A{i}")  # у Prime — свежее остальных
        give_tier(self.user_a, "prime")
        data = self.client.get("/api/listings/").json()["results"]
        flags = [x["boosted"] for x in data]
        self.assertEqual(flags, [True] * 3 + [False] * 7)
        self.assertTrue(all(x["title"].startswith("A") for x in data[:3]))

    def test_free_listings_keep_default_order_and_not_boosted(self):
        self.ad(self.user_a, "A0")
        self.ad(self.user_b, "B0")
        self.assertEqual(self.titles(), ["B0", "A0"])
        self.assertFalse(any(x["boosted"] for x in self.client.get("/api/listings/").json()["results"]))

    def test_boosted_stay_on_top_under_sorting_and_sorting_applies_inside_groups(self):
        a = self.ad(self.user_a, "A0")
        a.listing_price = 9_000_000
        a.save()
        expensive = self.ad(self.user_b, "B-dear")
        expensive.listing_price = 8_000_000
        expensive.save()
        self.ad(self.user_b, "B-cheap")
        give_tier(self.user_a, "prime")
        # Prime-объявление дорогое, но остаётся первым; у остальных работает выбранная сортировка по цене
        self.assertEqual(self.titles(ordering="listing_price"), ["A0", "B-cheap", "B-dear"])
        self.assertEqual(self.titles(ordering="-listing_price"), ["A0", "B-dear", "B-cheap"])


class SupportPriorityTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_superuser("root@example.com", self.password)

    def write(self, user, body):
        thread, _ = SupportThread.objects.get_or_create(user=user)
        SupportMessage.objects.create(thread=thread, author=user, body=body)
        thread.last_message_at = timezone.now()
        thread.save()

    def test_prime_waiting_threads_go_first_and_are_flagged(self):
        self.write(self.user_a, "Free, старше")
        self.write(self.user_b, "Prime, новее")
        self.write(self.user_a, "Free снова")  # у Free самое свежее сообщение
        give_tier(self.user_b, "prime")
        self.login(self.admin)
        rows = self.client.get("/api/admin/support/threads/").json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        self.assertEqual([r["user_email"] for r in rows], ["b@example.com", "a@example.com"])
        self.assertEqual([r["priority"] for r in rows], [True, False])
