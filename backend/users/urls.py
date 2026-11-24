from django.urls import path

from .views import (
    PasswordResetConfirmView, PasswordResetRequestView,
    MeView, PasswordChangeView, RegisterView, TelegramLinkView, ThrottledTokenObtainPairView, ThrottledTokenRefreshView,
    TourProgressView,
)

urlpatterns = [
    path("auth/register/", RegisterView.as_view()),
    path("auth/token/", ThrottledTokenObtainPairView.as_view()),
    path("auth/token/refresh/", ThrottledTokenRefreshView.as_view()),
    path("auth/password-reset/", PasswordResetRequestView.as_view()),
    path("auth/password-reset/confirm/", PasswordResetConfirmView.as_view()),
    path("me/", MeView.as_view()),
    path("me/password/", PasswordChangeView.as_view()),
    path("me/telegram-link/", TelegramLinkView.as_view()),
    path("tour/", TourProgressView.as_view()),
]
