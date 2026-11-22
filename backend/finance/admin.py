from django.contrib import admin

from .models import Expense, MeterReading

admin.site.register(Expense)
admin.site.register(MeterReading)
