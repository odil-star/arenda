import threading
import unittest

from django.db import connection, connections
from django.test import TransactionTestCase

from billing.tests import payme_auth  # noqa: F401  (проверяем, что модуль импортируется)
from users.models import User

from .models import Lease, Payment, PaymentTransaction, Property, Tenant
from .services import PaymentError, apply_payment, create_lease


@unittest.skipUnless(connection.vendor == "postgresql", "нужна реальная блокировка строк PostgreSQL")
class ConcurrentPaymentTests(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user("c@example.com", "x")
        prop = Property.objects.create(owner=self.owner, name="P", address="A")
        tenant = Tenant.objects.create(owner=self.owner, full_name="T")
        from datetime import date
        lease = create_lease(owner=self.owner, actor=self.owner, property=prop, tenant=tenant,
                             start_date=date(2025, 1, 1), end_date=date(2025, 3, 1), rent_amount=1000,
                             deposit_amount=0, payment_day=5)
        self.payment = lease.payments.first()

    def run_parallel(self, jobs):
        results, barrier = [], threading.Barrier(len(jobs))

        def worker(job):
            try:
                barrier.wait()
                results.append(job())
            except PaymentError as exc:
                results.append(exc.code)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=worker, args=(j,)) for j in jobs]
        [t.start() for t in threads]
        [t.join() for t in threads]
        return results

    def test_same_key_applied_once(self):
        job = lambda: apply_payment(payment_id=self.payment.pk, amount=300, provider="click", external_id="same")
        results = self.run_parallel([job] * 8)
        self.assertEqual(len(results), 8)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 300)
        self.assertEqual(PaymentTransaction.objects.count(), 1)

    def test_different_keys_never_overpay(self):
        jobs = [lambda i=i: apply_payment(payment_id=self.payment.pk, amount=400, provider="manual",
                                          external_id=f"k{i}") for i in range(6)]
        results = self.run_parallel(jobs)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount_paid, 800)  # 1000 // 400 = 2 успешных оплаты
        self.assertEqual(PaymentTransaction.objects.count(), 2)
        self.assertEqual(results.count("amount"), 4)
