import base64

from cryptography.hazmat.primitives import serialization
from django.core.management.base import BaseCommand
from py_vapid import Vapid


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class Command(BaseCommand):
    help = "Сгенерировать пару VAPID-ключей для Web Push (вставьте в backend/.env)."

    def handle(self, *args, **options):
        vapid = Vapid()
        vapid.generate_keys()
        private = _b64(vapid.private_key.private_numbers().private_value.to_bytes(32, "big"))
        public = _b64(vapid.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        self.stdout.write(f"VAPID_PUBLIC_KEY={public}\nVAPID_PRIVATE_KEY={private}")
