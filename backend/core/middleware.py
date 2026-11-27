from . import assistants


class ResetAssistantMiddleware:
    """Сбрасывает «текущего помощника» в начале каждого запроса — чтобы значение не осталось от предыдущего."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        assistants.set_current(None)
        try:
            return self.get_response(request)
        finally:
            assistants.set_current(None)
