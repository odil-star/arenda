from rest_framework import serializers

from core.mixins import OwnedPrimaryKeyRelatedField
from leasing.models import Property

from .models import Expense, MeterReading


class MeterReadingSerializer(serializers.ModelSerializer):
    property = OwnedPrimaryKeyRelatedField(queryset=Property.objects.all())
    property_name = serializers.CharField(source="property.name", read_only=True)
    value = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=0)

    class Meta:
        model = MeterReading
        fields = ("id", "property", "property_name", "meter", "reading_date", "value", "note", "created_at")
        read_only_fields = ("id", "created_at")
        validators = []

    def validate(self, attrs):
        inst = self.instance
        prop = attrs.get("property", inst.property if inst else None)
        meter = attrs.get("meter", inst.meter if inst else None)
        day = attrs.get("reading_date", inst.reading_date if inst else None)
        value = attrs.get("value", inst.value if inst else None)
        others = MeterReading.objects.filter(property=prop, meter=meter)
        if inst:
            others = others.exclude(pk=inst.pk)
        if others.filter(reading_date=day).exists():
            raise serializers.ValidationError({"reading_date": ["На эту дату показание уже внесено."]})
        previous = others.filter(reading_date__lt=day).order_by("-reading_date").first()
        if previous and value < previous.value:
            raise serializers.ValidationError(
                {"value": [f"Показание не может быть меньше предыдущего ({previous.value})."]})
        following = others.filter(reading_date__gt=day).order_by("reading_date").first()
        if following and value > following.value:
            raise serializers.ValidationError(
                {"value": [f"Показание не может быть больше следующего ({following.value})."]})
        return attrs


class ExpenseSerializer(serializers.ModelSerializer):
    property = OwnedPrimaryKeyRelatedField(queryset=Property.objects.all())
    property_name = serializers.CharField(source="property.name", read_only=True)
    amount = serializers.IntegerField(min_value=1)

    class Meta:
        model = Expense
        fields = ("id", "property", "property_name", "category", "amount", "expense_date", "description",
                  "created_at")
        read_only_fields = ("id", "created_at")
