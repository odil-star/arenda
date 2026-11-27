import { isAxiosError } from "axios";
import { api } from "@/api/client";
import { tokens } from "@/api/tokens";
import type { TokenPair } from "@/api/types";
import { router } from "@/routes";

/** Минимум из Telegram WebApp API, который нам нужен (https://core.telegram.org/bots/webapps). */
interface TelegramWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** Открыто ли приложение внутри Telegram (initData есть только там). */
export function telegramWebApp(): TelegramWebApp | null {
  const app = typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
  return app && app.initData ? app : null;
}

/**
 * Запуск внутри Telegram: сообщаем, что готовы, раскрываем окно, подстраиваем тему и кнопку «Назад»,
 * входим без пароля по подписи Telegram. Если чат не привязан или вход не удался — остаётся обычная страница входа.
 * Вызывается до первой отрисовки, чтобы пользователь не видел мигание экрана входа.
 */
export async function bootstrapTelegramMiniApp(): Promise<void> {
  const app = telegramWebApp();
  if (!app) return;
  app.ready();
  app.expand();

  try {
    // Тему берём из Telegram, пока пользователь сам не выбирал её в профиле.
    if (!localStorage.getItem("theme")) localStorage.setItem("theme", app.colorScheme);
  } catch {
    /* без сохранения */
  }
  const dark = app.colorScheme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  app.setHeaderColor?.(dark ? "#0b0f14" : "#ffffff");
  app.setBackgroundColor?.(dark ? "#0b0f14" : "#ffffff");

  // «Назад» Telegram работает как «назад» в приложении и скрыта на главном экране.
  app.BackButton.onClick(() => void router.navigate(-1));
  const syncBack = (path: string) => (["/", "/cabinet", "/login"].includes(path) ? app.BackButton.hide() : app.BackButton.show());
  syncBack(router.state.location.pathname);
  router.subscribe((state) => syncBack(state.location.pathname));

  if (tokens.refresh) return; // уже вошли
  try {
    const { data } = await api.post<TokenPair>("/auth/telegram/", { init_data: app.initData });
    tokens.setPair(data, "");
  } catch (error) {
    // 400 not_linked — Telegram ещё не привязан: пусть войдёт обычным способом и привяжет бота в профиле
    if (!isAxiosError(error)) throw error;
  }
}
