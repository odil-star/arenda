from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('leasing', '0009_has_telegram'),
    ]

    operations = [
        migrations.AddField(
            model_name='lease',
            name='hidden_by_tenant',
            field=models.BooleanField(default=False, verbose_name='Скрыт жильцом'),
        ),
    ]
