from django.db import models
from django.db.models import Q

from core.models import OwnedModel


class MeterReading(OwnedModel):
    class Meter(models.TextChoices):
        ELECTRICITY = "electricity", "Электричество"
        WATER_COLD = "water_cold", "Холодная вода"
        WATER_HOT = "water_hot", "Горячая вода"
        GAS = "gas", "Газ"
        HEATING = "heating", "Отопление"

    property = models.ForeignKey("leasing.Property", on_delete=models.CASCADE, related_name="meter_readings")
    meter = models.CharField(max_length=20, choices=Meter.choices)
    reading_date = models.DateField()
    value = models.DecimalField(max_digits=14, decimal_places=3)
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ("-reading_date", "-id")
        constraints = [
            models.UniqueConstraint(fields=["property", "meter", "reading_date"], name="meter_unique_per_day"),
            models.CheckConstraint(condition=Q(value__gte=0), name="meter_value_non_negative"),
        ]


class Expense(OwnedModel):
    class Category(models.TextChoices):
        UTILITIES = "utilities", "Коммунальные платежи"
        REPAIR = "repair", "Ремонт"
        TAX = "tax", "Налоги"
        MANAGEMENT = "management", "Управление"
        OTHER = "other", "Другое"

    property = models.ForeignKey("leasing.Property", on_delete=models.CASCADE, related_name="expenses")
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    amount = models.PositiveBigIntegerField()
    expense_date = models.DateField()
    description = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ("-expense_date", "-id")
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="expense_amount_positive")]
        indexes = [models.Index(fields=["owner", "expense_date"])]
