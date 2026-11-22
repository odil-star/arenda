from rest_framework import serializers

from .models import MAX_BODY, SupportMessage, SupportThread


class MessageSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = SupportMessage
        fields = ("id", "from_staff", "author_name", "body", "created_at")

    def get_author_name(self, obj) -> str | None:
        # пользователю не раскрываем, какой именно сотрудник ответил
        if obj.from_staff and not self.context.get("staff"):
            return None
        author = obj.author
        if author is None:
            return None
        return author.get_full_name() or author.email


class MessageInputSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=MAX_BODY, trim_whitespace=True)


class AdminThreadSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    user_name = serializers.SerializerMethodField()
    user_email = serializers.SerializerMethodField()
    user_phone = serializers.CharField(source="user.phone", read_only=True)
    user_role = serializers.SerializerMethodField()
    unread = serializers.IntegerField(read_only=True, default=0)
    last_body = serializers.CharField(read_only=True, default="")
    last_from_staff = serializers.BooleanField(read_only=True, default=False)

    class Meta:
        model = SupportThread
        fields = (
            "id", "user_id", "user_name", "user_email", "user_phone", "user_role", "status",
            "unread", "last_body", "last_from_staff", "last_message_at", "created_at",
        )

    def get_user_name(self, obj) -> str:
        return obj.user.get_full_name() or ""

    def get_user_email(self, obj) -> str:
        email = obj.user.email
        # аккаунты, созданные по SMS, получают технический email — его не показываем
        return "" if email.endswith(".invalid") else email

    def get_user_role(self, obj) -> str:
        profile = getattr(obj.user, "profile", None)
        return profile.role if profile else "landlord"
