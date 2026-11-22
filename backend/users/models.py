from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver


class UserManager(BaseUserManager):
    use_in_migrations = True

    def get_by_natural_key(self, email):
        return self.get(email__iexact=email)

    def _create(self, email, password, **extra):
        if not email:
            raise ValueError("Email обязателен")
        user = self.model(email=email.strip().lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self._create(email, password, **extra)


class User(AbstractUser):
    """Арендодатель — владелец данных в системе."""

    class Language(models.TextChoices):
        RU = "ru", "Русский"
        UZ = "uz", "Oʻzbekcha"

    username = None
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=32, blank=True)
    passport_data = models.CharField("Паспортные данные", max_length=255, blank=True)
    language = models.CharField(max_length=2, choices=Language.choices, default=Language.RU)
    payment_details = models.TextField("Реквизиты для оплаты", blank=True)
    telegram_chat_id = models.BigIntegerField(null=True, blank=True, unique=True)
    telegram_link_code = models.CharField(max_length=16, null=True, blank=True, unique=True)
    telegram_link_expires_at = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []
    objects = UserManager()

    @property
    def full_name(self):
        return self.get_full_name() or self.email


class UserProfile(models.Model):
    """Роль пользователя: арендодатель (владелец данных) или жилец (видит только свои данные)."""

    class Role(models.TextChoices):
        LANDLORD = "landlord", "Арендодатель"
        TENANT = "tenant", "Жилец"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.LANDLORD)

    def __str__(self):
        return f"{self.user_id}: {self.role}"


@receiver(post_save, sender=User)
def ensure_profile(sender, instance, created, **kwargs):
    """Каждый новый пользователь — арендодатель, пока явно не задана другая роль."""
    if created:
        UserProfile.objects.get_or_create(user=instance)
