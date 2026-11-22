from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('leasing', '0005_lease_payment_details'),
    ]

    operations = [
        migrations.AddField(
            model_name='lease',
            name='inventory',
            field=models.TextField(blank=True, verbose_name='Что входит в аренду'),
        ),
    ]
