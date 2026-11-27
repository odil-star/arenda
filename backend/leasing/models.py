from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils import timezone

from core.models import OwnedModel
from core.phone import try_normalize_phone


class Property(OwnedModel):
    class Kind(models.TextChoices):
        APARTMENT = "apartment", "Квартира"
        HOUSE = "house", "Дом"
        COMMERCIAL = "commercial", "Коммерческое"
        OTHER = "other", "Другое"

    name = models.CharField(max_length=200)
    address = models.CharField(max_length=255)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.APARTMENT)
    area_m2 = models.DecimalField("Площадь, м²", max_digits=8, decimal_places=2, null=True, blank=True)
    is_under_repair = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    # Публикация в поиске квартир — только с согласия владельца.
    is_listed = models.BooleanField("Показывать в поиске", default=False)
    listing_price = models.PositiveBigIntegerField("Цена в месяц, сум", null=True, blank=True)
    listing_description = models.TextField("Описание для объявления", blank=True)
    rooms = models.PositiveSmallIntegerField("Комнат", null=True, blank=True)
    # Телефон для связи в объявлении; пусто — берётся номер аккаунта владельца.
    contact_phone = models.CharField("Телефон для связи", max_length=32, blank=True)
    # На номере есть Telegram: только тогда гостям показывается кнопка «Написать».
    has_telegram = models.BooleanField("На этом номере есть Telegram", default=True)

    class Renovation(models.TextChoices):
        NONE = "none", "Без ремонта"
        COSMETIC = "cosmetic", "Косметический"
        EURO = "euro", "Евроремонт"
        DESIGNER = "designer", "Дизайнерский"

    class Furniture(models.TextChoices):
        NONE = "none", "Без мебели"
        PARTIAL = "partial", "Частично"
        FULL = "full", "С мебелью"

    # Что входит в квартиру: ключи из AMENITIES.
    AMENITIES = ("fridge", "washer", "ac", "tv", "wifi", "oven", "microwave", "heating", "parking", "balcony")

    floor = models.PositiveSmallIntegerField("Этаж", null=True, blank=True)
    floors_total = models.PositiveSmallIntegerField("Этажность дома", null=True, blank=True)
    renovation = models.CharField("Ремонт", max_length=16, choices=Renovation.choices, blank=True)
    furniture = models.CharField("Мебель", max_length=16, choices=Furniture.choices, blank=True)
    amenities = models.JSONField("Что входит", default=list, blank=True)
    # Правила дома и полезная информация для жильцов (Wi-Fi, парковка, мусор, телефоны служб).
    house_rules = models.TextField("Правила дома и полезная информация", blank=True)
    # Точка на карте (WGS84). Пусто — объект не показывается на карте в поиске.
    latitude = models.DecimalField("Широта", max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField("Долгота", max_digits=9, decimal_places=6, null=True, blank=True)

    class Meta:
        ordering = ("name", "id")
        verbose_name_plural = "properties"
        constraints = [
            models.CheckConstraint(
                condition=Q(area_m2__isnull=True) | Q(area_m2__gt=0), name="property_area_positive"
            ),
            models.CheckConstraint(
                condition=Q(is_listed=False) | Q(listing_price__gt=0), name="property_listed_has_price"
            ),
            models.CheckConstraint(
                condition=Q(latitude__isnull=True, longitude__isnull=True)
                | Q(latitude__isnull=False, longitude__isnull=False,
                    latitude__gte=-90, latitude__lte=90, longitude__gte=-180, longitude__lte=180),
                name="property_coords_valid",
            ),
        ]

    def __str__(self):
        return self.name


class SavedSearch(models.Model):
    """Сохранённый поиск гостя: фильтры + Telegram-чат, куда слать новые объявления.

    Гость не регистрируется: страница создаёт поиск и отдаёт ссылку на бота (/start s_<token>).
    seen_ids — объявления, о которых уже знаем (при привязке записываются все текущие совпадения).
    """

    token = models.CharField(max_length=32, unique=True)
    filters = models.JSONField(default=dict)
    language = models.CharField(max_length=2, default="ru")
    chat_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    seen_ids = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")

    def __str__(self):
        return f"search {self.pk}"


class Tenant(OwnedModel):
    class Language(models.TextChoices):
        RU = "ru", "Русский"
        UZ = "uz", "Oʻzbekcha"

    full_name = models.CharField(max_length=200)
    phone = models.CharField(max_length=32, blank=True, db_index=True)  # E.164: +998XXXXXXXXX
    # Аккаунт жильца. У одного User может быть несколько Tenant (разные арендодатели).
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="tenant_records",
    )
    # Разрешить привязку аккаунта по номеру телефона (SMS-код). Защита от опечатки в номере.
    phone_claim_enabled = models.BooleanField(default=True)
    telegram_chat_id = models.BigIntegerField(null=True, blank=True)
    passport = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    language = models.CharField(max_length=2, choices=Language.choices, default=Language.RU)
    # Одноразовый код для привязки к Telegram-боту
    link_code = models.CharField(max_length=16, null=True, blank=True, unique=True)
    link_code_expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("full_name", "id")

    def save(self, *args, **kwargs):
        normalized = try_normalize_phone(self.phone) if self.phone else None
        if normalized and normalized != self.phone:
            self.phone = normalized
            fields = kwargs.get("update_fields")
            if fields is not None:
                kwargs["update_fields"] = {*fields, "phone"}
        super().save(*args, **kwargs)

    def __str__(self):
        return self.full_name


class Lease(OwnedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Действует"
        ENDED = "ended", "Завершён"

    property = models.ForeignKey(Property, on_delete=models.PROTECT, related_name="leases")
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT, related_name="leases")
    start_date = models.DateField()
    end_date = models.DateField()
    rent_amount = models.PositiveBigIntegerField("Аренда в месяц, сум")
    deposit_amount = models.PositiveBigIntegerField("Залог, сум", default=0)
    payment_day = models.PositiveSmallIntegerField("День оплаты (1-28)")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    notes = models.TextField(blank=True)
    # Что входит в аренду: мебель, техника, ключи, счётчики — по одному пункту в строке.
    inventory = models.TextField("Что входит в аренду", blank=True)
    # Реквизиты оплаты этого договора (карта и т.п.); пусто — берутся общие реквизиты арендодателя.
    payment_details = models.TextField("Реквизиты для оплаты", blank=True)
    # Пеня за просрочку: процент от остатка за каждый день; 0 — выключена. Лимит — % от остатка.
    penalty_percent_per_day = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    penalty_cap_percent = models.DecimalField(max_digits=5, decimal_places=2, default=100)
    # Жилец убрал завершённый договор из своего кабинета. У арендодателя договор остаётся.
    hidden_by_tenant = models.BooleanField("Скрыт жильцом", default=False)

    class Meta:
        ordering = ("-start_date", "-id")
        constraints = [
            models.CheckConstraint(condition=Q(end_date__gt=F("start_date")), name="lease_dates_valid"),
            models.CheckConstraint(
                condition=Q(payment_day__gte=1, payment_day__lte=28), name="lease_payment_day_1_28"
            ),
            models.CheckConstraint(condition=Q(rent_amount__gt=0), name="lease_rent_positive"),
            models.CheckConstraint(
                condition=Q(penalty_percent_per_day__gte=0, penalty_percent_per_day__lte=10,
                            penalty_cap_percent__gte=0, penalty_cap_percent__lte=100),
                name="lease_penalty_ranges",
            ),
            models.UniqueConstraint(
                fields=["property"],
                condition=Q(status="active"),
                name="lease_one_active_per_property",
            ),
        ]

    def __str__(self):
        return f"{self.property} — {self.tenant} ({self.start_date}–{self.end_date})"

    def get_payment_details(self) -> str:
        return self.payment_details.strip() or self.owner.payment_details.strip()


class Payment(OwnedModel):
    class Status(models.TextChoices):
        PAID = "paid", "Оплачен"
        PARTIAL = "partial", "Частично"
        OVERDUE = "overdue", "Просрочен"
        PENDING = "pending", "Ожидается"

    lease = models.ForeignKey(Lease, on_delete=models.CASCADE, related_name="payments")
    due_date = models.DateField()
    amount_due = models.PositiveBigIntegerField()
    amount_paid = models.PositiveBigIntegerField(default=0)
    paid_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ("due_date", "id")
        constraints = [
            models.UniqueConstraint(fields=["lease", "due_date"], name="payment_unique_lease_due"),
            models.CheckConstraint(condition=Q(amount_due__gt=0), name="payment_due_positive"),
            models.CheckConstraint(
                condition=Q(amount_paid__lte=F("amount_due")), name="payment_paid_not_over_due"
            ),
        ]
        indexes = [models.Index(fields=["owner", "due_date"])]

    @property
    def remaining(self):
        return self.amount_due - self.amount_paid

    @property
    def status(self):
        """Вычисляется, не хранится."""
        if self.amount_paid >= self.amount_due:
            return self.Status.PAID
        if self.amount_paid > 0:
            return self.Status.PARTIAL
        if self.due_date < timezone.localdate():
            return self.Status.OVERDUE
        return self.Status.PENDING

    @property
    def days_overdue(self):
        if self.remaining <= 0:
            return 0
        return max((timezone.localdate() - self.due_date).days, 0)

    @property
    def penalty(self):
        """Начисленная пеня на текущий остаток (целые сумы, округление вниз). Не входит в amount_due."""
        rate, days = self.lease.penalty_percent_per_day, self.days_overdue
        if not rate or not days:
            return 0
        accrued = self.remaining * rate * days / 100
        cap = self.remaining * self.lease.penalty_cap_percent / 100
        return int(min(accrued, cap))

    def __str__(self):
        return f"{self.lease_id}: {self.due_date} {self.amount_paid}/{self.amount_due}"


class PaymentTransaction(OwnedModel):
    """Одна оплата. (provider, external_id) уникальны — повторный вебхук не создаст дубль."""

    class Provider(models.TextChoices):
        MANUAL = "manual", "Вручную"
        PAYME = "payme", "Payme"
        CLICK = "click", "Click"

    class State(models.IntegerChoices):
        CREATED = 1, "Создана"          # провайдер зарезервировал сумму, деньги ещё не зачтены
        COMPLETED = 2, "Проведена"
        CANCELLED = -1, "Отменена до проведения"
        REFUNDED = -2, "Возвращена после проведения"

    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="transactions")
    provider = models.CharField(max_length=10, choices=Provider.choices)
    external_id = models.CharField(max_length=128)
    amount = models.PositiveBigIntegerField()
    state = models.SmallIntegerField(choices=State.choices, default=State.COMPLETED)
    reason = models.SmallIntegerField(null=True, blank=True)
    provider_time_ms = models.BigIntegerField(null=True, blank=True)
    performed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(fields=["provider", "external_id"], name="paytx_unique_provider_ext"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="paytx_amount_positive"),
        ]


def document_upload_to(instance, filename):
    import uuid
    from pathlib import Path

    return f"documents/{instance.owner_id}/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


class Document(OwnedModel):
    """Документ (скан договора, паспорт) или фото объекта. Привязан ровно к одной сущности."""

    class Kind(models.TextChoices):
        DOCUMENT = "document", "Документ"
        PHOTO = "photo", "Фото"

    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.DOCUMENT)
    property = models.ForeignKey(Property, null=True, blank=True, on_delete=models.CASCADE,
                                 related_name="documents")
    lease = models.ForeignKey(Lease, null=True, blank=True, on_delete=models.CASCADE, related_name="documents")
    tenant = models.ForeignKey(Tenant, null=True, blank=True, on_delete=models.CASCADE,
                               related_name="documents")
    file = models.FileField(upload_to=document_upload_to, max_length=255)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(
                name="document_exactly_one_target",
                condition=(
                    Q(property__isnull=False, lease__isnull=True, tenant__isnull=True)
                    | Q(property__isnull=True, lease__isnull=False, tenant__isnull=True)
                    | Q(property__isnull=True, lease__isnull=True, tenant__isnull=False)
                ),
            ),
            models.CheckConstraint(
                name="document_photo_only_for_property",
                condition=Q(kind="document") | Q(property__isnull=False),
            ),
        ]


def brand_logo_upload_to(instance, filename):
    import uuid
    from pathlib import Path

    return f"brand/{instance.user_id}/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


class ContractBrand(models.Model):
    """Prime: свой бланк договора — название, реквизиты и логотип в шапке PDF.

    Данные хранятся и после окончания тарифа, но в договор попадают только пока тариф Prime или выше.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="contract_brand")
    company_name = models.CharField("Название", max_length=150, blank=True)
    requisites = models.TextField("Реквизиты и контакты", max_length=1000, blank=True)
    logo = models.FileField(upload_to=brand_logo_upload_to, max_length=255, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"brand:{self.user_id}"
