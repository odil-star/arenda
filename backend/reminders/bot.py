"""Telegram-бот на aiogram 3 (long polling). Запуск: python manage.py run_bot"""
from asgiref.sync import sync_to_async
from django.conf import settings

from . import bot_logic
from .messages import t


def build_dispatcher():
    from aiogram import Dispatcher, Router
    from aiogram.filters import Command, CommandObject
    from aiogram.types import Message

    router = Router()

    @router.message(Command("start", "link"))
    async def start(message: Message, command: CommandObject):
        if command.args:
            text = await sync_to_async(bot_logic.link)(command.args, message.chat.id)
        else:
            text = t("ru", "need_link")
        await message.answer(text)

    @router.message(Command("balance"))
    async def balance(message: Message):
        await message.answer(await sync_to_async(bot_logic.balance_text)(message.chat.id))

    @router.message(Command("pay_info"))
    async def pay_info(message: Message):
        await message.answer(await sync_to_async(bot_logic.pay_info_text)(message.chat.id))

    @router.message()
    async def fallback(message: Message):
        await message.answer(t("ru", "help"))

    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    return dispatcher


async def run_polling():
    from aiogram import Bot

    if not settings.TELEGRAM_BOT_TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN не задан")
    bot = Bot(settings.TELEGRAM_BOT_TOKEN)
    await build_dispatcher().start_polling(bot)
