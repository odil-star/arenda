from django.urls import path

from . import views

urlpatterns = [
    path("support/messages/", views.SupportMessagesView.as_view()),
    path("support/read/", views.SupportReadView.as_view()),
    path("support/unread/", views.SupportUnreadView.as_view()),
]
