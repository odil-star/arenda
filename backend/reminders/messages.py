"""Шаблоны сообщений (ru/uz). Суммы — в сумах, целые числа."""


def money(value):
    return f"{int(value):,}".replace(",", " ")


TEMPLATES = {
    "ru": {
        "tenant_before": "Напоминание: через {days} дн. срок оплаты аренды «{property}». "
                         "Сумма: {amount} сум, срок: {due}.",
        "tenant_due": "Сегодня срок оплаты аренды «{property}». Сумма: {amount} сум.",
        "tenant_overdue": "Оплата аренды «{property}» просрочена на {days} дн. "
                          "К оплате: {amount} сум (срок был {due}).",
        "tenant_manual": "Напоминание от арендодателя: оплатите аренду «{property}». "
                         "К оплате: {amount} сум (срок: {due}).",
        "owner_receipt": "Новый чек об оплате: {tenant} — {property}, {amount} сум. Подтвердите его в приложении.",
        "owner_header": "Сводка на {date}",
        "owner_overdue": "Просрочено: {count} шт. на {amount} сум",
        "owner_due": "Сегодня к оплате: {count} шт. на {amount} сум",
        "owner_soon": "Ближайшие {days} дн.: {count} шт. на {amount} сум",
        "owner_no_telegram": "(у арендатора нет Telegram)",
        "owner_line": "• {tenant} — {property}: {amount} сум, срок {due}",
        "unknown_code": "Код не найден или устарел. Попросите арендодателя создать новый.",
        "linked_tenant": "Готово! Telegram привязан, {name}. Команды: /balance, /pay_info.",
        "linked_owner": "Готово! Telegram привязан к аккаунту владельца. Вы будете получать ежедневные сводки.",
        "chat_taken": "Этот Telegram уже привязан к другому аккаунту.",
        "need_link": "Сначала привяжите аккаунт: отправьте /start КОД (код выдаёт арендодатель).",
        "no_debt": "Задолженности нет.",
        "balance_title": "«{property}»",
        "balance_overdue": "Просрочено: {amount} сум",
        "balance_next": "Ближайший платёж: {amount} сум до {due}",
        "balance_clear": "Все платежи оплачены.",
        "pay_info_title": "Как оплатить «{property}»",
        "pay_info_amount": "К оплате сейчас: {amount} сум",
        "pay_info_none": "Реквизиты не указаны — свяжитесь с арендодателем.",
        "help": "Команды: /balance — баланс, /pay_info — как оплатить.",
    },
    "uz": {
        "tenant_before": "Eslatma: «{property}» ijarasi uchun to'lov muddatiga {days} kun qoldi. "
                         "Summa: {amount} so'm, muddat: {due}.",
        "tenant_due": "Bugun «{property}» ijarasi uchun to'lov kuni. Summa: {amount} so'm.",
        "tenant_overdue": "«{property}» ijarasi to'lovi {days} kunga kechikdi. "
                          "To'lash kerak: {amount} so'm (muddat: {due}).",
        "tenant_manual": "Ijaraga beruvchidan eslatma: «{property}» ijarasini to'lang. "
                         "To'lash kerak: {amount} so'm (muddat: {due}).",
        "owner_receipt": "To'lov cheki keldi: {tenant} — {property}, {amount} so'm. Ilovada tasdiqlang.",
        "owner_header": "{date} holatiga xulosa",
        "owner_overdue": "Muddati o'tgan: {count} ta, {amount} so'm",
        "owner_due": "Bugun to'lanishi kerak: {count} ta, {amount} so'm",
        "owner_soon": "Keyingi {days} kun: {count} ta, {amount} so'm",
        "owner_no_telegram": "(ijarachida Telegram yo'q)",
        "owner_line": "• {tenant} — {property}: {amount} so'm, muddat {due}",
        "unknown_code": "Kod topilmadi yoki eskirgan. Ijaraga beruvchidan yangi kod so'rang.",
        "linked_tenant": "Tayyor! Telegram ulandi, {name}. Buyruqlar: /balance, /pay_info.",
        "linked_owner": "Tayyor! Telegram egasi hisobiga ulandi. Har kuni xulosa olasiz.",
        "chat_taken": "Bu Telegram boshqa hisobga ulangan.",
        "need_link": "Avval hisobni ulang: /start KOD yuboring (kodni ijaraga beruvchi beradi).",
        "no_debt": "Qarzdorlik yo'q.",
        "balance_title": "«{property}»",
        "balance_overdue": "Muddati o'tgan: {amount} so'm",
        "balance_next": "Keyingi to'lov: {amount} so'm, muddat {due}",
        "balance_clear": "Barcha to'lovlar to'langan.",
        "pay_info_title": "«{property}» uchun to'lov tartibi",
        "pay_info_amount": "Hozir to'lash kerak: {amount} so'm",
        "pay_info_none": "Rekvizitlar ko'rsatilmagan — ijaraga beruvchi bilan bog'laning.",
        "help": "Buyruqlar: /balance — balans, /pay_info — qanday to'lash.",
    },
}


def t(lang, key, **kwargs):
    templates = TEMPLATES.get(lang) or TEMPLATES["ru"]
    return templates[key].format(**kwargs)
