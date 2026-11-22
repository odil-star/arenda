import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_POLL_MS, type MessagesCursor, type MessagesPage, type SupportMessage, type ThreadStatus } from "@/api/support";

export interface ChatSource {
  /** ключ диалога: при смене всё загружается заново */
  key: string;
  messages: (cursor: MessagesCursor, signal?: AbortSignal) => Promise<MessagesPage>;
  send: (body: string) => Promise<SupportMessage>;
  read: () => Promise<void>;
  /** true — смотрит сотрудник: «свои» сообщения — from_staff */
  staff: boolean;
  /** что обновить в кеше после прочтения/отправки (значки непрочитанного) */
  invalidate: readonly unknown[][];
}

export interface PendingMessage {
  tempId: string;
  body: string;
  failed: boolean;
}

function merge(list: SupportMessage[], incoming: SupportMessage[]) {
  if (incoming.length === 0) return list;
  const seen = new Set(list.map((m) => m.id));
  const next = [...list, ...incoming.filter((m) => !seen.has(m.id))];
  next.sort((a, b) => a.id - b.id);
  return next;
}

/**
 * Состояние диалога: первая страница, опрос новых сообщений по курсору `after`,
 * подгрузка старых по `before`, отправка с «висящим» сообщением до ответа сервера.
 * Пока вкладка видна, входящие сообщения сразу отмечаются прочитанными.
 */
export function useChat(source: ChatSource) {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [status, setStatus] = useState<ThreadStatus | null>(null);
  const [staffOnline, setStaffOnline] = useState<boolean | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<PendingMessage[]>([]);

  const sourceRef = useRef(source);
  sourceRef.current = source;
  const lastIdRef = useRef(0);
  const readIdRef = useRef(0);

  const invalidate = useCallback(() => {
    for (const key of sourceRef.current.invalidate) void qc.invalidateQueries({ queryKey: key });
  }, [qc]);

  const markRead = useCallback(
    (list: SupportMessage[]) => {
      const s = sourceRef.current;
      const incoming = list.filter((m) => m.from_staff !== s.staff);
      const last = incoming.at(-1)?.id ?? 0;
      if (last <= readIdRef.current || document.visibilityState !== "visible") return;
      readIdRef.current = last;
      s.read().then(invalidate).catch(() => {
        readIdRef.current = 0; // повторим при следующем опросе
      });
    },
    [invalidate],
  );

  const apply = useCallback(
    (page: MessagesPage, mode: "replace" | "append" | "prepend") => {
      if (page.status !== undefined) setStatus(page.status);
      if (page.staff_online !== undefined) setStaffOnline(page.staff_online);
      setMessages((prev) => {
        const next = mode === "replace" ? page.results : merge(prev, page.results);
        lastIdRef.current = next.at(-1)?.id ?? 0;
        return next;
      });
      if (mode !== "append") setHasMore(page.has_more);
    },
    [],
  );

  // входящие — прочитаны, пока вкладка видна (и сразу при возврате на неё)
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  useEffect(() => markRead(messages), [messages, markRead]);
  useEffect(() => {
    const onVisible = () => markRead(messagesRef.current);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  // первая загрузка и смена диалога
  useEffect(() => {
    const controller = new AbortController();
    setMessages([]);
    setPending([]);
    setStatus(null);
    setHasMore(false);
    setError(null);
    setLoading(true);
    lastIdRef.current = 0;
    readIdRef.current = 0;
    sourceRef.current
      .messages({}, controller.signal)
      .then((page) => apply(page, "replace"))
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source.key, apply]);

  // опрос новых сообщений; при возврате на вкладку — сразу
  useEffect(() => {
    if (loading || error) return;
    let stopped = false;
    let controller: AbortController | null = null;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const page = await sourceRef.current.messages({ after: lastIdRef.current || undefined }, controller.signal);
        if (!stopped) apply(page, "append");
      } catch {
        /* сеть моргнула — попробуем на следующем шаге */
      }
    };
    const timer = window.setInterval(() => void poll(), CHAT_POLL_MS);
    const onVisible = () => void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [source.key, loading, error, apply]);

  const loadOlder = useCallback(async () => {
    const first = messages[0]?.id;
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      apply(await sourceRef.current.messages({ before: first }), "prepend");
    } finally {
      setLoadingOlder(false);
    }
  }, [messages, loadingOlder, apply]);

  const deliver = useCallback(
    async (tempId: string, body: string) => {
      try {
        const message = await sourceRef.current.send(body);
        setPending((p) => p.filter((x) => x.tempId !== tempId));
        setMessages((prev) => {
          const next = merge(prev, [message]);
          lastIdRef.current = Math.max(lastIdRef.current, message.id);
          return next;
        });
        // сообщение пользователя переоткрывает закрытый диалог
        if (!sourceRef.current.staff) setStatus("open");
        invalidate();
        return true;
      } catch (e) {
        setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, failed: true } : x)));
        throw e;
      }
    },
    [invalidate],
  );

  const send = useCallback(
    (body: string) => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPending((p) => [...p, { tempId, body, failed: false }]);
      return deliver(tempId, body);
    },
    [deliver],
  );

  const retry = useCallback(
    (tempId: string) => {
      const item = pending.find((p) => p.tempId === tempId);
      if (!item) return Promise.resolve(false);
      setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, failed: false } : x)));
      return deliver(tempId, item.body);
    },
    [pending, deliver],
  );

  const discard = useCallback((tempId: string) => setPending((p) => p.filter((x) => x.tempId !== tempId)), []);

  return { messages, pending, status, setStatus, staffOnline, hasMore, loading, loadingOlder, error, loadOlder, send, retry, discard };
}
