"""Тестовые объявления для страницы /listings. Повторный запуск пересоздаёт их (метка [demo])."""
import io
import random

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction
from PIL import Image, ImageDraw, ImageFilter

from leasing.models import Document, Property
from users.models import User

DEMO_EMAIL = "demo-landlord@example.com"
TAG = "[demo] "

# (название, адрес, комнат, м², этаж, этажей, цена, ремонт, мебель, удобства, описание)
ITEMS = [
    ("Студия у метро Чилонзор", "Ташкент, Чиланзарский р-н, кв-л 7", 1, 32, 3, 9, 2_800_000, "euro", "full",
     ["fridge", "washer", "ac", "tv", "wifi"], "Уютная студия рядом с метро, свежий ремонт, всё для жизни."),
    ("1-комнатная на Юнусабаде", "Ташкент, Юнусабадский р-н, 4-й квартал", 1, 41, 5, 12, 3_500_000, "euro", "full",
     ["fridge", "washer", "ac", "wifi", "microwave"], "Светлая квартира в тихом дворе, рядом парк и магазины."),
    ("2-комнатная в центре", "Ташкент, Мирзо-Улугбекский р-н, ул. Мустакиллик", 2, 62, 6, 9, 5_200_000, "designer", "full",
     ["fridge", "washer", "ac", "tv", "wifi", "oven", "balcony"], "Дизайнерский ремонт, панорамные окна, охраняемый двор."),
    ("2-комнатная Яккасарай", "Ташкент, Яккасарайский р-н, ул. Шота Руставели", 2, 55, 2, 5, 4_300_000, "euro", "partial",
     ["fridge", "washer", "heating", "balcony"], "Кирпичный дом, тихая улица, рядом школа и детсад."),
    ("3-комнатная для семьи", "Ташкент, Шайхантахурский р-н, Себзар", 3, 84, 4, 9, 6_000_000, "euro", "full",
     ["fridge", "washer", "ac", "tv", "wifi", "oven", "microwave", "parking"], "Просторная квартира для большой семьи, парковка во дворе."),
    ("Бюджетная 1-комнатная", "Ташкент, Сергелийский р-н, Янги Сергели", 1, 35, 1, 5, 1_900_000, "cosmetic", "partial",
     ["fridge", "heating"], "Недорого, чистая, рядом остановка и рынок."),
    ("Квартира в новостройке", "Ташкент, Мирабадский р-н, ЖК «Навруз»", 2, 58, 11, 16, 5_800_000, "euro", "full",
     ["fridge", "washer", "ac", "tv", "wifi", "oven", "microwave", "parking"], "Новый дом, лифт, подземный паркинг, видеонаблюдение."),
    ("Студия на Амир Темура", "Ташкент, Мирзо-Улугбекский р-н, пр. Амира Темура", 1, 28, 8, 14, 3_100_000, "designer", "full",
     ["fridge", "washer", "ac", "tv", "wifi"], "Современная студия в центре, идеально для одного или пары."),
    ("2-комнатная на Беруни", "Ташкент, Алмазарский р-н, ул. Беруни", 2, 60, 3, 9, 4_600_000, "euro", "full",
     ["fridge", "washer", "ac", "wifi", "balcony"], "Рядом метро Беруни и университет, удобная планировка."),
    ("Дом с двором в Юнусабаде", "Ташкент, Юнусабадский р-н, ул. Чапанота", 4, 140, 1, 2, 9_500_000, "euro", "partial",
     ["fridge", "washer", "ac", "heating", "parking", "oven"], "Частный дом с садом и гаражом, тихий район."),
    ("1-комнатная без мебели", "Ташкент, Учтепинский р-н, кв-л 15", 1, 38, 4, 9, 2_300_000, "cosmetic", "none",
     ["heating", "balcony"], "Чистая квартира под вашу мебель, косметический ремонт."),
    ("3-комнатная Чиланзар", "Ташкент, Чиланзарский р-н, кв-л 20", 3, 75, 5, 9, 4_900_000, "euro", "full",
     ["fridge", "washer", "ac", "tv", "wifi", "microwave"], "Тёплая, светлая, рядом школа, парк и метро."),
    ("Квартира у Ташкент-Сити", "Ташкент, Яшнабадский р-н, ул. Бабура", 2, 64, 15, 22, 7_200_000, "designer", "full",
     ["fridge", "washer", "ac", "tv", "wifi", "oven", "microwave", "parking"], "Высокий этаж, вид на город, премиальный жилой комплекс."),
    ("Коммерческое помещение", "Ташкент, Шайхантахурский р-н, ул. Навои", None, 90, 1, 5, 8_000_000, "euro", "none",
     ["ac", "wifi", "parking"], "Первый этаж, отдельный вход, подходит под офис или магазин."),
    ("2-комнатная в Сергели", "Ташкент, Сергелийский р-н, ул. Янги Сергели", 2, 52, 6, 9, 3_200_000, "cosmetic", "partial",
     ["fridge", "washer", "heating", "balcony"], "Хороший вариант по цене, удобная транспортная доступность."),
]


W, H = 1200, 800
PALETTES = [  # (стена, пол, акцент мебели)
    ((236, 228, 214), (170, 130, 92), (92, 112, 130)),
    ((222, 232, 238), (196, 170, 138), (186, 98, 80)),
    ((240, 236, 230), (120, 96, 78), (70, 110, 96)),
    ((228, 222, 236), (182, 160, 140), (120, 90, 140)),
    ((238, 232, 220), (150, 150, 150), (214, 160, 70)),
    ((218, 230, 224), (190, 160, 120), (60, 80, 110)),
]
SCENES = ("living", "bedroom", "kitchen")


def _gradient(draw, box, top, bottom):
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        t = (y - y0) / max(1, y1 - y0 - 1)
        draw.line([(x0, y), (x1, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))


def render_room(rng, scene):
    """Рисует упрощённый интерьер комнаты (окно, пол, мебель) — заглушка вместо реального фото."""
    wall, floor, accent = rng.choice(PALETTES)
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    horizon = int(H * 0.62)
    _gradient(d, (0, 0, W, horizon), tuple(min(255, c + 10) for c in wall), tuple(max(0, c - 22) for c in wall))
    _gradient(d, (0, horizon, W, H), floor, tuple(max(0, c - 55) for c in floor))
    # окно со светом
    wx = rng.randint(120, 420)
    d.rectangle((wx, 90, wx + 360, 430), fill=(250, 250, 245), outline=(150, 140, 130), width=10)
    _gradient(d, (wx + 10, 100, wx + 350, 420), (176, 214, 244), (232, 244, 252))
    d.line((wx + 180, 100, wx + 180, 420), fill=(250, 250, 245), width=8)
    d.line((wx + 10, 260, wx + 350, 260), fill=(250, 250, 245), width=8)
    dark = tuple(max(0, c - 40) for c in accent)
    if scene == "living":
        d.rounded_rectangle((560, 430, 1120, 640), 40, fill=accent)            # диван
        d.rounded_rectangle((540, 400, 640, 640), 30, fill=dark)
        d.rounded_rectangle((1040, 400, 1140, 640), 30, fill=dark)
        d.rounded_rectangle((640, 400, 1040, 500), 36, fill=tuple(min(255, c + 25) for c in accent))
        d.rectangle((700, 690, 960, 730), fill=(110, 84, 62))                  # столик
    elif scene == "bedroom":
        d.rounded_rectangle((420, 440, 1060, 660), 30, fill=(245, 242, 236))   # кровать
        d.rounded_rectangle((420, 380, 1060, 470), 24, fill=dark)              # изголовье
        d.rounded_rectangle((420, 520, 1060, 660), 30, fill=accent)            # одеяло
        d.rounded_rectangle((470, 470, 640, 540), 20, fill=(255, 255, 255))
        d.rounded_rectangle((840, 470, 1010, 540), 20, fill=(255, 255, 255))
        d.rectangle((1090, 500, 1170, 640), fill=(120, 94, 72))                # тумба
    else:
        d.rectangle((420, 330, 1140, 640), fill=(238, 238, 236))               # кухонный гарнитур
        d.rectangle((420, 330, 1140, 360), fill=(90, 90, 96))
        for x in range(430, 1130, 140):
            d.rectangle((x, 380, x + 120, 630), fill=accent, outline=dark, width=3)
            d.ellipse((x + 98, 480, x + 110, 492), fill=(235, 235, 235))
        d.rectangle((900, 120, 1140, 290), fill=(228, 228, 226), outline=(160, 160, 160), width=3)  # шкаф
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    # лёгкий шум, чтобы не выглядело плоско
    px = img.load()
    for _ in range(9000):
        x, y = rng.randrange(W), rng.randrange(H)
        r, g, b = px[x, y]
        n = rng.randint(-6, 6)
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=82)
    return buf.getvalue()


class Command(BaseCommand):
    help = "Создаёт ~15 тестовых объявлений с фото для страницы /listings"

    @transaction.atomic
    def handle(self, *args, **options):
        owner, created = User.objects.get_or_create(
            email=DEMO_EMAIL, defaults={"first_name": "Демо", "last_name": "Арендодатель", "phone": "+998901234567"}
        )
        if created:
            owner.set_unusable_password()
            owner.save()
        for old in Property.objects.filter(owner=owner, name__startswith=TAG):
            for doc in old.documents.all():
                doc.file.delete(save=False)
        Property.objects.filter(owner=owner, name__startswith=TAG).delete()
        rng = random.Random(42)

        for name, address, rooms, area, floor, floors, price, reno, furn, amen, desc in ITEMS:
            kind = Property.Kind.COMMERCIAL if rooms is None else (
                Property.Kind.HOUSE if "Дом" in name else Property.Kind.APARTMENT)
            prop = Property.objects.create(
                owner=owner, name=TAG + name, address=address, kind=kind, area_m2=area, rooms=rooms,
                floor=floor, floors_total=floors, renovation=reno, furniture=furn, amenities=amen,
                is_listed=True, listing_price=price, listing_description=desc,
                contact_phone="+998901234567", has_telegram=True,
                # точка на карте: вокруг центра Ташкента
                latitude=round(41.2995 + rng.uniform(-0.07, 0.07), 6), longitude=round(69.2401 + rng.uniform(-0.09, 0.09), 6),
            )
            for i, scene in enumerate(SCENES[: rng.choice((2, 3, 3))], start=1):
                data = render_room(rng, scene)
                doc = Document(owner=owner, kind=Document.Kind.PHOTO, property=prop,
                               original_name=f"photo{i}.jpg", content_type="image/jpeg", size=len(data))
                doc.file.save(f"demo{prop.pk}_{i}.jpg", ContentFile(data), save=False)
                doc.save()
        self.stdout.write(self.style.SUCCESS(f"Создано объявлений: {len(ITEMS)}"))
