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
        "help": "Команды: /balance — баланс, /pay_info — как оплатить, /unlink — отвязать Telegram.\n"
                "Чтобы отправить чек об оплате, пришлите фото или PDF прямо в этот чат.",
        "btn_balance": "💰 Баланс",
        "btn_pay_info": "🏦 Реквизиты",
        "btn_confirm": "✅ Принять",
        "btn_reject": "❌ Отклонить",
        "unlinked": "Telegram отвязан. Чтобы привязать снова, отправьте /start КОД.",
        "receipt_need_user": "Отправка чеков доступна после входа в приложение. Войдите на сайте, затем повторите.",
        "receipt_no_payment": "Сейчас нет платежей, по которым можно отправить чек.",
        "receipt_choose": "Выберите платёж, к которому относится чек:",
        "receipt_choice_line": "«{property}» — {amount} сум, срок {due}",
        "receipt_sent": "Чек отправлен арендодателю на проверку («{property}», {amount} сум).",
        "receipt_error": "Не удалось отправить чек: {reason}",
        "receipt_expired": "Файл потерялся. Отправьте чек ещё раз.",
        "receipt_owner_only": "Это действие доступно только арендодателю.",
        "receipt_processed": "Чек уже обработан.",
        "receipt_ok_owner": "✅ Чек подтверждён: {tenant}, {amount} сум.",
        "receipt_no_owner": "❌ Чек отклонён: {tenant}, {amount} сум.",
        "receipt_ok_tenant": "Арендодатель подтвердил ваш чек: «{property}», {amount} сум.",
        "receipt_no_tenant": "Арендодатель отклонил ваш чек по «{property}». Свяжитесь с ним.",
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
        "help": "Buyruqlar: /balance — balans, /pay_info — qanday to'lash, /unlink — Telegramni uzish.\n"
                "To'lov chekini yuborish uchun rasm yoki PDF faylni shu chatga yuboring.",
        "btn_balance": "💰 Balans",
        "btn_pay_info": "🏦 Rekvizitlar",
        "btn_confirm": "✅ Qabul qilish",
        "btn_reject": "❌ Rad etish",
        "unlinked": "Telegram uzildi. Qayta ulash uchun /start KOD yuboring.",
        "receipt_need_user": "Chek yuborish uchun avval ilovaga kiring, so'ng qayta urinib ko'ring.",
        "receipt_no_payment": "Hozir chek yuborish mumkin bo'lgan to'lov yo'q.",
        "receipt_choose": "Chek qaysi to'lovga tegishli ekanini tanlang:",
        "receipt_choice_line": "«{property}» — {amount} so'm, muddat {due}",
        "receipt_sent": "Chek ijaraga beruvchiga tekshiruv uchun yuborildi («{property}», {amount} so'm).",
        "receipt_error": "Chekni yuborib bo'lmadi: {reason}",
        "receipt_expired": "Fayl topilmadi. Chekni qayta yuboring.",
        "receipt_owner_only": "Bu amal faqat ijaraga beruvchi uchun.",
        "receipt_processed": "Chek allaqachon ko'rib chiqilgan.",
        "receipt_ok_owner": "✅ Chek tasdiqlandi: {tenant}, {amount} so'm.",
        "receipt_no_owner": "❌ Chek rad etildi: {tenant}, {amount} so'm.",
        "receipt_ok_tenant": "Ijaraga beruvchi chekingizni tasdiqladi: «{property}», {amount} so'm.",
        "receipt_no_tenant": "Ijaraga beruvchi «{property}» bo'yicha chekingizni rad etdi. U bilan bog'laning.",
    },
}


def t(lang, key, **kwargs):
    templates = TEMPLATES.get(lang) or TEMPLATES["ru"]
    return templates[key].format(**kwargs)
