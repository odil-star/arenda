import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, cleanParams } from "./client";
import type { ISODateTime } from "./types";

/* Чат с поддержкой платформы: арендодатель / жилец ↔ сотрудники (админ и «поддержка»). */

export interface SupportMessage {
  id: number;
  from_staff: boolean;
  /** имя сотрудника видно только сотрудникам; пользователю — null */
  author_name: string | null;
  body: string;
  created_at: ISODateTime;
}

export type ThreadStatus = "open" | "closed";

export interface MessagesPage {
  results: SupportMessage[];
  has_more: boolean;
  status: ThreadStatus | null;
  unread?: number;
  /** кто-то из сотрудников «в сети» (только в ответе пользователю) */
  staff_online?: boolean;
}

export interface MessagesCursor {
  after?: number;
  before?: number;
}

export interface SupportThread {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  user_phone: string;
  user_role: "landlord" | "tenant";
  /** Prime и выше: отвечаем первыми */
  priority?: boolean;
  status: ThreadStatus;
  unread: number;
  last_body: string;
  last_from_staff: boolean;
  last_message_at: ISODateTime;
  created_at: ISODateTime;
}

export const MAX_MESSAGE = 2000;
/** Опрос новых сообщений, пока чат открыт */
export const CHAT_POLL_MS = 5_000;
/** Опрос счётчиков непрочитанного для значков в меню */
export const UNREAD_POLL_MS = 30_000;

// ---------- пользователь ----------

export const supportUserApi = {
  messages: async (cursor: MessagesCursor, signal?: AbortSignal) =>
    (await api.get<MessagesPage>("/support/messages/", { params: cleanParams(cursor), signal })).data,
  send: async (body: string) => (await api.post<SupportMessage>("/support/messages/", { body })).data,
  read: async () => {
    await api.post("/support/read/");
  },
};

export function useSupportUnread(enabled = true) {
  return useQuery({
    queryKey: ["support", "unread"],
    enabled,
    refetchInterval: UNREAD_POLL_MS,
    queryFn: async ({ signal }) => (await api.get<{ unread: number }>("/support/unread/", { signal })).data.unread,
  });
}

// ---------- сотрудники ----------

export interface ThreadFilters {
  search?: string;
  status?: ThreadStatus | "";
  unread?: "true" | "";
}

export function useSupportThreads(filters: ThreadFilters) {
  return useQuery({
    queryKey: ["admin-support", "threads", filters],
    refetchInterval: CHAT_POLL_MS * 2,
    queryFn: async ({ signal }) =>
      (
        await api.get<{ results: SupportThread[]; count: number }>("/admin/support/threads/", {
          params: { ...cleanParams(filters), page_size: 100 },
          signal,
        })
      ).data,
  });
}

export function useSupportThread(id: number | undefined) {
  return useQuery({
    queryKey: ["admin-support", "thread", id],
    enabled: id !== undefined,
    queryFn: async ({ signal }) => (await api.get<SupportThread>(`/admin/support/threads/${id}/`, { signal })).data,
  });
}

export function adminThreadApi(id: number) {
  const base = `/admin/support/threads/${id}`;
  return {
    messages: async (cursor: MessagesCursor, signal?: AbortSignal) =>
      (await api.get<MessagesPage>(`${base}/messages/`, { params: cleanParams(cursor), signal })).data,
    send: async (body: string) => (await api.post<SupportMessage>(`${base}/reply/`, { body })).data,
    read: async () => {
      await api.post(`${base}/read/`);
    },
  };
}

export function useAdminSupportUnread(enabled = true) {
  return useQuery({
    queryKey: ["admin-support", "unread"],
    enabled,
    refetchInterval: UNREAD_POLL_MS,
    queryFn: async ({ signal }) =>
      (await api.get<{ threads: number }>("/admin/support/threads/unread/", { signal })).data.threads,
  });
}

export interface SupportStats {
  /** открытые диалоги, где последнее слово за пользователем */
  to_answer: number;
  /** закрыто за сегодня; обнуляется в полночь (после 23:59) */
  closed_today: number;
  day_end: ISODateTime;
}

export function useSupportStats() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-support", "stats"],
    refetchInterval: CHAT_POLL_MS * 2,
    queryFn: async ({ signal }) => (await api.get<SupportStats>("/admin/support/threads/stats/", { signal })).data,
  });
  // новые сутки начались — сразу обновляем, не дожидаясь опроса (на вкладке в фоне таймеры замедляются)
  const dayEnd = query.data?.day_end;
  useEffect(() => {
    if (!dayEnd) return;
    const ms = Math.min(new Date(dayEnd).getTime() - Date.now() + 1000, 2 ** 31 - 1);
    const id = window.setTimeout(() => void qc.invalidateQueries({ queryKey: ["admin-support", "stats"] }), Math.max(ms, 1000));
    return () => window.clearTimeout(id);
  }, [dayEnd, qc]);
  return query;
}

export function useSetThreadStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: ThreadStatus }) =>
      (await api.post<SupportThread>(`/admin/support/threads/${id}/${status === "closed" ? "close" : "reopen"}/`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-support"] }),
  });
}

/* ---------- мой статус в чате (сотрудник) ---------- */

export interface StaffPresence {
  status: "online" | "offline";
  /** «в сети» с учётом того, что админка открыта */
  online: boolean;
  /** в сети кто-то из сотрудников (видят пользователи) */
  anyone_online: boolean;
}

const PRESENCE_KEY = ["admin-support", "presence"] as const;

/** Статус + «я здесь»: пока админка открыта, раз в минуту отмечаемся (иначе через 10 минут — не в сети). */
export function useMyPresence(enabled = true) {
  return useQuery({
    queryKey: PRESENCE_KEY,
    enabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    queryFn: async ({ signal }) => (await api.get<StaffPresence>("/admin/support/presence/", { signal })).data,
  });
}

export function useSetPresence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (status: StaffPresence["status"]) =>
      (await api.post<StaffPresence>("/admin/support/presence/", { status })).data,
    onSuccess: (data) => qc.setQueryData(PRESENCE_KEY, data),
  });
}
