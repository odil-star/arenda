"""Проверка загружаемых файлов: тип определяется по содержимому, а не по заявленному клиентом."""
from django.conf import settings
from rest_framework.exceptions import ValidationError

# (расширения, сигнатура, MIME)
SIGNATURES = (
    ("pdf", b"%PDF-", "application/pdf"),
    ("jpg", b"\xff\xd8\xff", "image/jpeg"),
    ("png", b"\x89PNG\r\n\x1a\n", "image/png"),
)
EXTENSION_ALIASES = {"jpeg": "jpg"}
ALLOWED = {"document": {"pdf", "jpg", "png"}, "photo": {"jpg", "png"}}


def sniff(head):
    for ext, signature, mime in SIGNATURES:
        if head.startswith(signature):
            return ext, mime
    return None, None


def validate_upload(file, kind):
    """Возвращает (content_type) или бросает ValidationError на русском."""
    limit = settings.UPLOAD_MAX_PHOTO_BYTES if kind == "photo" else settings.UPLOAD_MAX_DOCUMENT_BYTES
    if file.size == 0:
        raise ValidationError({"file": ["Файл пустой."]})
    if file.size > limit:
        raise ValidationError({"file": [f"Файл слишком большой (максимум {limit // (1024 * 1024)} МБ)."]})
    file.seek(0)
    head = file.read(16)
    file.seek(0)
    real_ext, mime = sniff(head)
    if real_ext is None or real_ext not in ALLOWED[kind]:
        allowed = ", ".join(sorted(ALLOWED[kind])).upper()
        raise ValidationError({"file": [f"Недопустимый тип файла. Разрешено: {allowed}."]})
    declared = file.name.rsplit(".", 1)[-1].lower() if "." in file.name else ""
    declared = EXTENSION_ALIASES.get(declared, declared)
    if declared != real_ext:
        raise ValidationError({"file": ["Расширение файла не соответствует его содержимому."]})
    return mime


MEDIA_EXTENSIONS = {
    "jpg": {"jpg"}, "png": {"png"}, "webp": {"webp"},
    "mp4": {"mp4", "m4v", "mov"}, "webm": {"webm"},
}


def sniff_media(head):
    """(тип, mime, вид) по первым байтам; вид — photo или video."""
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg", "photo"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png", "photo"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp", "image/webp", "photo"
    if head[4:8] == b"ftyp":
        return "mp4", ("video/quicktime" if head[8:12] == b"qt  " else "video/mp4"), "video"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "webm", "video/webm", "video"
    return None, None, None


def validate_media(file):
    """Фото (JPG/PNG/WebP) или видео (MP4/MOV/WebM) по содержимому. Возвращает (kind, content_type)."""
    if file.size == 0:
        raise ValidationError({"file": ["Файл пустой."]})
    file.seek(0)
    head = file.read(16)
    file.seek(0)
    real, mime, kind = sniff_media(head)
    if real is None:
        raise ValidationError({"file": ["Недопустимый тип файла. Разрешены фото (JPG, PNG, WebP) и видео (MP4, MOV, WebM)."]})
    limit = settings.UPLOAD_MAX_MEDIA_VIDEO_BYTES if kind == "video" else settings.UPLOAD_MAX_MEDIA_PHOTO_BYTES
    if file.size > limit:
        raise ValidationError({"file": [f"Файл слишком большой (максимум {limit // (1024 * 1024)} МБ)."]})
    declared = file.name.rsplit(".", 1)[-1].lower() if "." in file.name else ""
    declared = EXTENSION_ALIASES.get(declared, declared)
    if declared not in MEDIA_EXTENSIONS[real]:
        raise ValidationError({"file": ["Расширение файла не соответствует его содержимому."]})
    return kind, mime
