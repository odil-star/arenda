import logging

from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


def api_exception_handler(exc, context):
    """Все ошибки — в формате {поле: [сообщения]}; внутренности наружу не отдаём."""
    response = exception_handler(exc, context)
    if response is None:
        logger.exception("Необработанная ошибка в API", exc_info=exc)
        return Response({"detail": ["Внутренняя ошибка сервера."]}, status=500)
    data = response.data
    if isinstance(data, list):
        response.data = {"non_field_errors": [str(item) for item in data]}
    elif isinstance(data, dict) and "detail" in data and not isinstance(data["detail"], list):
        data["detail"] = [str(data["detail"])]
    return response
