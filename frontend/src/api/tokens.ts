import type { TokenPair } from "./types";

const ACCESS = "auth.access";
const REFRESH = "auth.refresh";
const USERNAME = "auth.username";
/** Сессия админа, пока он смотрит сервис глазами арендодателя; IMPERSONATING хранит email арендодателя. */
const ADMIN_BACKUP = "auth.admin_backup";
const IMPERSONATING = "auth.impersonating";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* хранилище недоступно (приватный режим) — живём без него */
  }
}

export const LOGOUT_EVENT = "auth:logout";

export const tokens = {
  get access() {
    return read(ACCESS);
  },
  get refresh() {
    return read(REFRESH);
  },
  get username() {
    return read(USERNAME);
  },
  setPair(pair: TokenPair, username?: string) {
    write(ACCESS, pair.access);
    write(REFRESH, pair.refresh);
    if (username !== undefined) write(USERNAME, username);
  },
  setAccess(access: string) {
    write(ACCESS, access);
  },
  /** Email арендодателя, которого сейчас просматривает админ; null — обычная сессия. */
  get impersonating() {
    return read(IMPERSONATING);
  },
  /** Подменяет токен на «только чтение» (без refresh), сессию админа прячет в запас. */
  startImpersonation(access: string, email: string) {
    if (!read(IMPERSONATING)) {
      write(ADMIN_BACKUP, JSON.stringify({ access: read(ACCESS), refresh: read(REFRESH), username: read(USERNAME) }));
    }
    write(ACCESS, access);
    write(REFRESH, null);
    write(USERNAME, email);
    write(IMPERSONATING, email);
  },
  /** Возвращает сессию админа. false — запаса нет (тогда вызывающий разлогинивает). */
  stopImpersonation(): boolean {
    const raw = read(ADMIN_BACKUP);
    write(ADMIN_BACKUP, null);
    write(IMPERSONATING, null);
    try {
      const saved = raw ? (JSON.parse(raw) as { access: string | null; refresh: string | null; username: string | null }) : null;
      if (saved?.access && saved.refresh) {
        write(ACCESS, saved.access);
        write(REFRESH, saved.refresh);
        write(USERNAME, saved.username);
        return true;
      }
    } catch {
      /* битый запас — считаем, что его нет */
    }
    this.clear();
    return false;
  },
  clear() {
    write(ACCESS, null);
    write(REFRESH, null);
    write(USERNAME, null);
    write(ADMIN_BACKUP, null);
    write(IMPERSONATING, null);
  },
};
