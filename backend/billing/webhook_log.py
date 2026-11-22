"""Журнал входящих вебхуков Payme/Click (для админа платформы).

Пишем запрос и ответ, но без секретов: подписи, пароли, ключи, токены маскируются.
Сбой самого журнала никогда не должен ломать приём платежа — всё обёрнуто в try/except.
"""
import functools
import ipaddress
import json
import logging
import time

from core.models import WebhookLog

logger = logging.getLogger(__name__)

SENSITIVE = ("sign", "pass", "secret", "key", "token", "auth")
MAX_JSON_CHARS = 4000


def redact(value):
    """Копия структуры, где значения «секретных» ключей заменены на ***."""
    if isinstance(value, dict):
        return {
            k: ("***" if any(s in str(k).lower() for s in SENSITIVE) else redact(v)) for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


def _compact(value):
    """Укладываем JSON в разумный размер, чтобы журнал не раздувался."""
    text = json.dumps(value, ensure_ascii=False, default=str)
    return value if len(text) <= MAX_JSON_CHARS else {"_truncated": text[:MAX_JSON_CHARS]}


def _int_or_none(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _describe(provider, request_data, response_data):
    """(метод, ok, код ошибки, id платежа графика)."""
    request_data = request_data if isinstance(request_data, dict) else {}
    response_data = response_data if isinstance(response_data, dict) else {}
    if provider == "payme":
        error = response_data.get("error")
        params = request_data.get("params") if isinstance(request_data.get("params"), dict) else {}
        account = params.get("account") if isinstance(params.get("account"), dict) else {}
        code = str(error.get("code")) if isinstance(error, dict) else ""
        return str(request_data.get("method") or ""), error is None, code, _int_or_none(account.get("payment_id"))
    code = response_data.get("error")
    action = str(request_data.get("action", ""))
    method = {"0": "prepare", "1": "complete"}.get(action, action)
    ok = code in (0, "0")
    return method, ok, "" if ok else str(code), _int_or_none(request_data.get("merchant_trans_id"))


def log_webhook(provider):
    """Декоратор метода post() вебхук-вьюхи."""

    def decorate(post):
        @functools.wraps(post)
        def wrapper(self, request, *args, **kwargs):
            started = time.monotonic()
            try:
                response = post(self, request, *args, **kwargs)
            except Exception as exc:
                _save(provider, request, None, started, error=type(exc).__name__)
                raise
            _save(provider, request, getattr(response, "data", None), started)
            return response

        return wrapper

    return decorate


def _save(provider, request, response_data, started, error=""):
    try:
        request_data = request.data
        if hasattr(request_data, "dict"):  # QueryDict (форма Click): одно значение на ключ
            request_data = request_data.dict()
        elif not isinstance(request_data, dict):
            request_data = {}
        method, ok, code, payment_id = _describe(provider, request_data, response_data)
        if error:
            ok, code = False, error
        remote = request.META.get("REMOTE_ADDR") or ""
        try:
            ipaddress.ip_address(remote)
        except ValueError:
            remote = None
        WebhookLog.objects.create(
            provider=provider, method=method[:64], ok=ok, error_code=code[:32], payment_id=payment_id,
            request=_compact(redact(request_data)),
            response=_compact(redact(response_data)) if isinstance(response_data, dict) else {},
            remote_addr=remote, duration_ms=int((time.monotonic() - started) * 1000),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось записать журнал вебхука %s", provider)
