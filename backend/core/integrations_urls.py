from django.urls import path

from . import assistants_api as a
from . import integrations_api as v

urlpatterns = [
    path("integrations/", v.IntegrationsView.as_view()),
    path("integrations/api-key/", v.ApiKeyView.as_view()),
    path("integrations/webhook/", v.WebhookView.as_view()),
    path("integrations/webhook/rotate-secret/", v.WebhookRotateView.as_view()),
    path("integrations/webhook/test/", v.WebhookTestView.as_view()),
    path("assistants/", a.AssistantListView.as_view()),
    path("assistants/<int:pk>/", a.AssistantDetailView.as_view()),
    path("assistants/<int:pk>/reset-password/", a.AssistantResetPasswordView.as_view()),
    path("v1/payments/", v.PaymentExportView.as_view()),
    path("v1/transactions/", v.TransactionExportView.as_view()),
    path("v1/leases/", v.LeaseExportView.as_view()),
    path("v1/properties/", v.PropertyExportView.as_view()),
    path("v1/tenants/", v.TenantExportView.as_view()),
]
