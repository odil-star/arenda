from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from core.permissions import user_role

from .models import User


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])

    class Meta:
        model = User
        fields = ("id", "email", "password", "first_name", "last_name", "phone")

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Пользователь с таким email уже существует.")
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class UserSerializer(serializers.ModelSerializer):
    telegram_linked = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()
    is_admin = serializers.SerializerMethodField()
    admin_role = serializers.SerializerMethodField()
    tours_seen = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id", "email", "first_name", "last_name", "phone", "passport_data",
            "language", "payment_details", "telegram_linked", "role", "is_admin", "admin_role", "tours_seen",
            "date_joined",
        )
        read_only_fields = ("id", "email", "telegram_linked", "role", "is_admin", "admin_role", "tours_seen", "date_joined")

    def get_tours_seen(self, obj):
        profile = getattr(obj, "profile", None)
        return profile.tours_seen if profile is not None else []

    def get_telegram_linked(self, obj):
        return obj.telegram_chat_id is not None

    def get_role(self, obj):
        return user_role(obj)

    def get_is_admin(self, obj):
        """Доступ к админ-разделу: администратор или сотрудник поддержки."""
        return obj.is_superuser or obj.is_staff

    def get_admin_role(self, obj):
        return "admin" if obj.is_superuser else "support" if obj.is_staff else None


class TourProgressSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["tenant", "landlord"])
    step = serializers.IntegerField(min_value=0, max_value=50)
    done = serializers.BooleanField(default=False)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField(write_only=True)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, max_length=128)
    new_password = serializers.CharField(write_only=True, max_length=128)
