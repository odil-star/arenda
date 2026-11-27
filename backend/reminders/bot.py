"""Telegram-бот на aiogram 3 (long polling). Запуск: python manage.py run_bot"""
import logging

from asgiref.sync import sync_to_async
from django.conf import settings

from . import bot_logic
from .messages import TEMPLATES, t

logger = logging.getLogger(__name__)

# Файл чека, ожидающий выбора платежа: {chat_id: (file_id, имя, размер)}. Живёт в памяти процесса;
# после перезапуска бота жилец просто присылает чек заново.
PENDING_FILES = {}
# Платёж, выбранный кнопкой «Оплатил(а)» под напоминанием: следующий файл чека относится к нему.
PREPARED_PAYMENT = {}


def _button_texts(key):
    return {TEMPLATES[lang][key] for lang in TEMPLATES}


def build_dispatcher():
    from aiogram import Bot, Dispatcher, F, Router
    from aiogram.filters import Command, CommandObject
    from aiogram.types import (
        CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, Message,
        ReplyKeyboardMarkup, ReplyKeyboardRemove,
    )

    router = Router()

    def menu(lang, owner):
        keys = (("btn_debtors", "btn_income"), ("btn_receipts",)) if owner else (
            ("btn_balance", "btn_pay_info"), ("btn_history", "btn_lease"))
        return ReplyKeyboardMarkup(
            keyboard=[[KeyboardButton(text=t(lang, key)) for key in row] for row in keys], resize_keyboard=True,
        )

    @router.message(Command("start", "link"))
    async def start(message: Message, command: CommandObject):
        if not command.args:
            if await sync_to_async(bot_logic.is_tenant)(message.chat.id) or                     await sync_to_async(bot_logic.is_owner)(message.chat.id):
                lang = await sync_to_async(bot_logic.language_of)(message.chat.id)
                await message.answer(t(lang, "help"), reply_markup=menu(lang, await sync_to_async(bot_logic.is_owner)(message.chat.id)))
                return
            # Не привязан: предлагаем войти по номеру телефона — без кода
            share = ReplyKeyboardMarkup(
                keyboard=[[KeyboardButton(text=t("ru", "btn_share_phone"), request_contact=True)]],
                resize_keyboard=True, one_time_keyboard=True,
            )
            await message.answer(t("ru", "share_phone_prompt") + "\n\n" + t("ru", "need_link"), reply_markup=share)
            return
        text = await sync_to_async(bot_logic.link)(command.args, message.chat.id)
        is_tenant = await sync_to_async(bot_logic.is_tenant)(message.chat.id)
        is_owner = await sync_to_async(bot_logic.is_owner)(message.chat.id)
        lang = await sync_to_async(bot_logic.language_of)(message.chat.id)
        await message.answer(text, reply_markup=menu(lang, is_owner) if (is_tenant or is_owner) else None)

    @router.message(F.contact)
    async def on_contact(message: Message):
        contact = message.contact
        # принимаем только собственный номер: Telegram сам подтверждает его при «Поделиться номером»
        if contact.user_id != message.from_user.id:
            await message.answer(t("ru", "phone_foreign"))
            return
        text = await sync_to_async(bot_logic.link_by_phone)(message.chat.id, contact.phone_number)
        is_tenant = await sync_to_async(bot_logic.is_tenant)(message.chat.id)
        lang = await sync_to_async(bot_logic.language_of)(message.chat.id)
        await message.answer(text, reply_markup=menu(lang, False) if is_tenant else ReplyKeyboardRemove())

    @router.message(Command("help"))
    async def help_(message: Message):
        lang = await sync_to_async(bot_logic.language_of)(message.chat.id)
        await message.answer(t(lang, "help"))

    @router.message(Command("unlink"))
    async def unlink(message: Message):
        text = await sync_to_async(bot_logic.unlink)(message.chat.id)
        await message.answer(text, reply_markup=ReplyKeyboardRemove())

    @router.message(Command("balance"))
    @router.message(F.text.in_(_button_texts("btn_balance")))
    async def balance(message: Message):
        await message.answer(await sync_to_async(bot_logic.balance_text)(message.chat.id))

    @router.message(Command("pay_info"))
    @router.message(F.text.in_(_button_texts("btn_pay_info")))
    async def pay_info(message: Message):
        await message.answer(await sync_to_async(bot_logic.pay_info_text)(message.chat.id))

    @router.message(Command("history"))
    @router.message(F.text.in_(_button_texts("btn_history")))
    async def history(message: Message):
        await message.answer(await sync_to_async(bot_logic.history_text)(message.chat.id))

    @router.message(Command("lease"))
    @router.message(F.text.in_(_button_texts("btn_lease")))
    async def lease(message: Message):
        await message.answer(await sync_to_async(bot_logic.lease_text)(message.chat.id))

    @router.message(Command("debtors"))
    @router.message(F.text.in_(_button_texts("btn_debtors")))
    async def debtors(message: Message):
        await message.answer(await sync_to_async(bot_logic.debtors_text)(message.chat.id))

    @router.message(Command("income"))
    @router.message(F.text.in_(_button_texts("btn_income")))
    async def income(message: Message):
        await message.answer(await sync_to_async(bot_logic.income_text)(message.chat.id))

    @router.message(Command("receipts"))
    @router.message(F.text.in_(_button_texts("btn_receipts")))
    async def receipts(message: Message):
        lang, rows = await sync_to_async(bot_logic.pending_receipts)(message.chat.id)
        if rows is None:
            await message.answer(t("ru", "receipt_owner_only"))
        elif not rows:
            await message.answer(t(lang, "no_pending_receipts"))
        for receipt_id, text in rows or []:
            markup = InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text=t(lang, "btn_confirm"), callback_data=f"rc:ok:{receipt_id}"),
                InlineKeyboardButton(text=t(lang, "btn_reject"), callback_data=f"rc:no:{receipt_id}"),
            ]])
            await message.answer(text, reply_markup=markup)

    async def handle_file(message: Message, file_id, name, size):
        chat_id = message.chat.id
        lang = await sync_to_async(bot_logic.language_of)(chat_id)
        if not await sync_to_async(bot_logic.is_tenant)(chat_id):
            await message.answer(t(lang, "need_link"))
            return
        if size and size > settings.UPLOAD_MAX_DOCUMENT_BYTES:
            limit = settings.UPLOAD_MAX_DOCUMENT_BYTES // (1024 * 1024)
            await message.answer(t(lang, "receipt_error", reason=f"файл больше {limit} МБ."))
            return
        prepared = PREPARED_PAYMENT.pop(chat_id, None)
        if prepared is not None:
            await submit(message.bot, chat_id, prepared, (file_id, name), reply_to=message)
            return
        _, payments = await sync_to_async(bot_logic.receivable_payments)(chat_id)
        if payments is None:
            await message.answer(t(lang, "receipt_need_user"))
            return
        if not payments:
            await message.answer(t(lang, "receipt_no_payment"))
            return
        if len(payments) == 1:
            await submit(message.bot, chat_id, payments[0].pk, (file_id, name), reply_to=message)
            return
        PENDING_FILES[chat_id] = (file_id, name, size)
        lines = await sync_to_async(bot_logic.payment_choice_lines)(chat_id, payments)
        markup = InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text=line, callback_data=f"rp:{pk}")] for pk, line in lines]
        )
        await message.answer(t(lang, "receipt_choose"), reply_markup=markup)

    async def submit(bot: Bot, chat_id, payment_id, file_info, reply_to):
        file_id, name = file_info
        buffer = await bot.download(file_id)
        text = await sync_to_async(bot_logic.submit_tenant_receipt)(chat_id, payment_id, buffer.read(), name)
        await reply_to.answer(text)

    @router.message(F.photo)
    async def on_photo(message: Message):
        photo = message.photo[-1]  # самое крупное; Telegram всегда отдаёт JPEG
        await handle_file(message, photo.file_id, "receipt.jpg", photo.file_size)

    @router.message(F.document)
    async def on_document(message: Message):
        document = message.document
        await handle_file(message, document.file_id, document.file_name or "receipt", document.file_size)

    @router.callback_query(F.data.startswith("pp:"))
    async def paid_button(query: CallbackQuery):
        chat_id = query.message.chat.id
        payment_id = int(query.data[3:])
        text = await sync_to_async(bot_logic.payment_prompt)(chat_id, payment_id)
        await query.answer()
        if text is None:
            return
        PREPARED_PAYMENT[chat_id] = payment_id
        await query.message.answer(text)

    @router.callback_query(F.data.startswith("rp:"))
    async def choose_payment(query: CallbackQuery):
        chat_id = query.message.chat.id
        pending = PENDING_FILES.pop(chat_id, None)
        lang = await sync_to_async(bot_logic.language_of)(chat_id)
        await query.answer()
        if pending is None:
            await query.message.edit_text(t(lang, "receipt_expired"))
            return
        file_id, name, _ = pending
        await query.message.edit_reply_markup(reply_markup=None)
        await submit(query.bot, chat_id, int(query.data[3:]), (file_id, name), reply_to=query.message)

    @router.callback_query(F.data.startswith("rc:"))
    async def review(query: CallbackQuery):
        _, action, receipt_id = query.data.split(":")
        reply, notices = await sync_to_async(bot_logic.review_receipt)(
            query.message.chat.id, int(receipt_id), action == "ok"
        )
        await query.answer()
        await query.message.edit_text(f"{query.message.text}\n\n{reply}", reply_markup=None)
        for chat_id, text in notices:
            try:
                await query.bot.send_message(chat_id, text)
            except Exception:  # noqa: BLE001 — жилец мог заблокировать бота; решение уже сохранено
                logger.warning("Не удалось уведомить жильца %s о решении по чеку", chat_id)

    @router.message()
    async def fallback(message: Message):
        lang = await sync_to_async(bot_logic.language_of)(message.chat.id)
        await message.answer(t(lang, "help"))

    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    return dispatcher


async def run_polling():
    from aiogram import Bot
    from aiogram.types import BotCommand

    if not settings.TELEGRAM_BOT_TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN не задан")
    bot = Bot(settings.TELEGRAM_BOT_TOKEN)
    await bot.set_my_commands([
        BotCommand(command="balance", description="Баланс / Balans"),
        BotCommand(command="pay_info", description="Как оплатить / Qanday to'lash"),
        BotCommand(command="history", description="История платежей / To'lovlar tarixi"),
        BotCommand(command="lease", description="Мой договор / Shartnomam"),
        BotCommand(command="debtors", description="Должники (владельцам) / Qarzdorlar"),
        BotCommand(command="income", description="Доходы за месяц (владельцам) / Daromad"),
        BotCommand(command="receipts", description="Чеки на проверке (владельцам) / Cheklar"),
        BotCommand(command="help", description="Помощь / Yordam"),
        BotCommand(command="unlink", description="Отвязать Telegram / Uzish"),
    ])
    if settings.FRONTEND_URL.startswith("https://"):  # мини-приложения Telegram открываются только по HTTPS
        from aiogram.types import MenuButtonWebApp, WebAppInfo
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(
            text="Кабинет", web_app=WebAppInfo(url=f"{settings.FRONTEND_URL}/cabinet")))
    await build_dispatcher().start_polling(bot)
