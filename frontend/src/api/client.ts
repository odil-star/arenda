import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { LOGOUT_EVENT, tokens } from "./tokens";
import type { TokenRefreshResponse } from "./types";

const baseURL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export const api = axios.create({
  baseURL: `${baseURL}/api`,
  headers: { "Content-Type": "application/json" },
  timeout: 20_000,
});

/** Отдельный инстанс без interceptor'ов, чтобы refresh не зациклился. */
const bare = axios.create({ baseURL: `${baseURL}/api`, timeout: 20_000 });

const AUTH_PATHS = ["/auth/token/", "/auth/register/"];

api.interceptors.request.use((config) => {
  const access = tokens.access;
  if (access && !AUTH_PATHS.some((p) => config.url?.startsWith(p))) {
    config.headers.set("Authorization", `Bearer ${access}`);
  }
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/** Один общий refresh на все одновременные 401. */
let refreshing: Promise<string> | null = null;

function refreshAccess(): Promise<string> {
  const refresh = tokens.refresh;
  if (!refresh) return Promise.reject(new Error("no refresh token"));
  refreshing ??= bare
    .post<TokenRefreshResponse>("/auth/token/refresh/", { refresh })
    .then(({ data }) => {
      tokens.setAccess(data.access);
      if (data.refresh) tokens.setPair({ access: data.access, refresh: data.refresh });
      return data.access;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export function forceLogout() {
  // токен просмотра истёк — возвращаем админа в его сессию, а не выбрасываем на логин
  if (tokens.impersonating && tokens.stopImpersonation()) {
    window.location.assign("/admin/landlords");
    return;
  }
  tokens.clear();
  window.dispatchEvent(new Event(LOGOUT_EVENT));
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const isAuthCall = AUTH_PATHS.some((p) => original?.url?.startsWith(p));

    if (error.response?.status !== 401 || !original || original._retried || isAuthCall) {
      return Promise.reject(error);
    }

    original._retried = true;
    try {
      const access = await refreshAccess();
      original.headers.set("Authorization", `Bearer ${access}`);
      return api(original);
    } catch (refreshError) {
      // Разлогиниваем, только если сервер отклонил сам refresh-токен (просрочен/недействителен)
      // или токена нет вовсе. Обрыв сети и 5xx сессию не трогают — токены остаются в localStorage.
      const status = axios.isAxiosError(refreshError) ? refreshError.response?.status : undefined;
      const noToken = !axios.isAxiosError(refreshError);
      if (noToken || status === 400 || status === 401 || status === 403) forceLogout();
      return Promise.reject(error);
    }
  },
);

/** Убирает пустые значения, чтобы не слать `?search=&kind=`. */
export function cleanParams<T extends object>(params: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  ) as Partial<T>;
}
