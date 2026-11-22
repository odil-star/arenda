from django.urls import path

from .click import ClickWebhookView
from .payme import PaymeWebhookView
from .views import InvoiceView

urlpatterns = [
    path("payments/<int:pk>/invoice/", InvoiceView.as_view()),
    path("webhooks/payme/", PaymeWebhookView.as_view()),
    path("webhooks/click/", ClickWebhookView.as_view()),
]
