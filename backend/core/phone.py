"""Нормализация телефонов Узбекистана к E.164 (+998XXXXXXXXX)."""
import re

from django.core.exceptions import ValidationError

_NON_DIGITS = re.compile(r"\D")
PHONE_ERROR = "Введите узбекский номер телефона: +998 XX XXX XX XX."


def normalize_phone(raw):
    """'+998901234567' / '998901234567' / '90 123 45 67' -> '+998901234567'. Иначе ValidationError."""
    digits = _NON_DIGITS.sub("", str(raw or ""))
    if len(digits) == 9:
        digits = "998" + digits
    if len(digits) == 12 and digits.startswith("998"):
        return "+" + digits
    raise ValidationError(PHONE_ERROR)


def try_normalize_phone(raw):
    """Как normalize_phone, но None вместо ошибки."""
    try:
        return normalize_phone(raw)
    except ValidationError:
        return None
