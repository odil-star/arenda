"""Общие помощники для тестов."""
from datetime import date

from django.core.cache import cache
from rest_framework.test import APITestCase

from leasing.models import Lease, Property, Tenant
from leasing.services import create_lease
from users.models import User


class OwnerTestCase(APITestCase):
    """Два изолированных владельца A и B; клиент по умолчанию авторизован как A."""

    password = "S3cret-pass-123"

    def setUp(self):
        cache.clear()  # сбрасываем счётчики троттлинга
        self.user_a = User.objects.create_user("a@example.com", self.password)
        self.user_b = User.objects.create_user("b@example.com", self.password)
        self.login(self.user_a)

    def login(self, user):
        self.client.force_authenticate(user)

    def make_property(self, owner=None, name="Квартира 1", **kw):
        return Property.objects.create(owner=owner or self.user_a, name=name, address="Ташкент", **kw)

    def make_tenant(self, owner=None, name="Иванов Иван", **kw):
        return Tenant.objects.create(owner=owner or self.user_a, full_name=name, phone="+998900000000", **kw)

    def make_lease(self, owner=None, prop=None, tenant=None, start=date(2025, 1, 1), end=date(2025, 4, 1),
                   rent=3_000_000, day=5, **kw):
        owner = owner or self.user_a
        prop = prop or self.make_property(owner)
        tenant = tenant or self.make_tenant(owner)
        return create_lease(
            owner=owner, actor=owner, property=prop, tenant=tenant, start_date=start, end_date=end,
            rent_amount=rent, deposit_amount=0, payment_day=day, **kw,
        )
