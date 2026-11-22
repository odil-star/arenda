import { AlertCircle, ArrowUp, Check, Loader2, RotateCw, X } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/states";
import { serverMessages } from "@/api/errors";
import { MAX_MESSAGE, type SupportMessage } from "@/api/support";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useChat, type ChatSource, type PendingMessage } from "./use-chat";

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function DayLabel({ iso }: { iso: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const key = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  const label = key === today ? t("support.today") : key === yesterday ? t("support.yesterday") : fmt.date(iso);
  return (
    <li className="sticky top-0 z-10 flex justify-center py-1.5" aria-hidden>
      <span className="rounded-full bg-muted/90 px-2.5 py-0.5 text-[11px] text-muted-foreground backdrop-blur">{label}</span>
    </li>
  );
}

/** Положение сообщения в серии подряд идущих от одного автора. */
interface GroupPos {
  first: boolean;
  last: boolean;
}

const SOLO: GroupPos = { first: true, last: true };

function Bubble({
  mine, children, meta, pos = SOLO, avatar,
}: { mine: boolean; children: ReactNode; meta: ReactNode; pos?: GroupPos; avatar?: ReactNode }) {
  return (
    <li className={cn("flex items-end gap-2", mine ? "justify-end" : "justify-start", pos.first ? "mt-3 first:mt-0" : "mt-0.5")}>
      {/* аватар собеседника — у последнего сообщения серии, остальным оставляем место, чтобы колонка не прыгала */}
      {avatar !== undefined && !mine && <span className="hidden w-8 shrink-0 sm:block">{pos.last ? avatar : null}</span>}
      <div
        className={cn(
          "max-w-[82%] rounded-2xl px-3 py-1.5 text-[15px] leading-snug shadow-sm sm:max-w-[65%] sm:text-sm",
          // «хвостик» — острый угол у края; у сообщений внутри серии острые оба угла со стороны автора
          mine
            ? cn("rounded-br-md bg-primary text-primary-foreground", !pos.first && "rounded-tr-md")
            : cn("rounded-bl-md border border-border bg-card text-foreground", !pos.first && "rounded-tl-md"),
        )}
      >
        <p className="whitespace-pre-wrap break-words">{children}</p>
        <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-[11px]", mine ? "text-primary-foreground/75" : "text-muted-foreground")}>
          {meta}
        </div>
      </div>
    </li>
  );
}

function MessageRow({
  message, mine, showAuthor, pos, avatar,
}: { message: SupportMessage; mine: boolean; showAuthor: boolean; pos: GroupPos; avatar?: ReactNode }) {
  const { t } = useTranslation();
  // сотрудник видит, кто из коллег ответил; пользователь — просто «Поддержка». В серии — только у последнего.
  const author = message.from_staff && pos.last ? (showAuthor ? message.author_name : t("support.staffName")) : null;
  return (
    <Bubble
      mine={mine}
      pos={pos}
      avatar={avatar}
      meta={
        <>
          {author && <span className="mr-1 font-medium">{author} ·</span>}
          <time dateTime={message.created_at}>{time(message.created_at)}</time>
          {mine && <Check className="size-3" aria-hidden />}
        </>
      }
    >
      {message.body}
    </Bubble>
  );
}

function PendingRow({
  item, onRetry, onDiscard, pos,
}: { item: PendingMessage; onRetry: () => void; onDiscard: () => void; pos: GroupPos }) {
  const { t } = useTranslation();
  return (
    <Bubble
      mine
      pos={pos}
      meta={
        item.failed ? (
          <span className="flex items-center gap-2">
            <AlertCircle className="size-3" aria-hidden />
            {t("support.notSent")}
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-0.5 underline underline-offset-2">
              <RotateCw className="size-3" aria-hidden />
              {t("support.retry")}
            </button>
            <button type="button" onClick={onDiscard} aria-label={t("support.discard")}>
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            {t("support.sending")}
          </span>
        )
      }
    >
      {item.body}
    </Bubble>
  );
}

function Composer({
  onSend, disabled, placeholder, className, quickReplies,
}: { onSend: (body: string) => void; disabled?: boolean; placeholder: string; className?: string; quickReplies?: string[] }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const trimmed = text.trim();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const submit = () => {
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    ref.current?.focus();
  };

  const insert = (reply: string) => {
    // повторное нажатие не дублирует фразу
    setText((prev) => (prev.includes(reply) ? prev : prev.trim() ? `${prev.trimEnd()} ${reply}` : reply));
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter — отправить, Shift+Enter — новая строка (на телефоне Enter — обычный перенос)
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      className={cn("shrink-0 border-t border-border bg-card px-2.5 pt-2.5 pb-2.5", className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {quickReplies && quickReplies.length > 0 && (
        <div className="-mx-2.5 mb-2 flex gap-1.5 overflow-x-auto px-2.5 [scrollbar-width:none]" role="group" aria-label={t("support.quickReplies")}>
          {quickReplies.map((reply) => (
            <button
              key={reply}
              type="button"
              disabled={disabled}
              onClick={() => insert(reply)}
              className="h-8 shrink-0 whitespace-nowrap rounded-full border border-border bg-background px-3 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
            >
              {reply}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
      <label className="sr-only" htmlFor="support-composer">
        {t("support.message")}
      </label>
      <textarea
        id="support-composer"
        ref={ref}
        rows={1}
        value={text}
        maxLength={MAX_MESSAGE}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        className="max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-[1.375rem] border border-input bg-background px-4 py-2.5 text-base leading-snug outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:text-sm"
      />
      <Button type="submit" size="icon" className="size-11 shrink-0 rounded-full" disabled={!trimmed || disabled} aria-label={t("support.send")}>
        <ArrowUp aria-hidden />
      </Button>
      </div>
    </form>
  );
}

interface ChatViewProps {
  source: ChatSource;
  /** пустой диалог: подсказка, о чём писать */
  emptyHint: ReactNode;
  /** над списком: шапка диалога (имя собеседника, действия); функция — получает состояние чата */
  header?: ReactNode | ((state: { status: ReturnType<typeof useChat>["status"]; staffOnline: boolean | null }) => ReactNode);
  /** под шапкой: баннер «диалог закрыт» и т. п.; получает текущий статус */
  notice?: (status: ReturnType<typeof useChat>["status"]) => ReactNode;
  className?: string;
  /** поле ввода: например, отступ снизу над плавающим меню телефона */
  composerClassName?: string;
  /** аватар собеседника у входящих сообщений */
  peerAvatar?: ReactNode;
  /** готовые фразы над полем ввода (для сотрудников) */
  quickReplies?: string[];
}

const GROUP_GAP_MS = 5 * 60_000;

/** Одна серия — подряд от одного автора, в один день и без паузы больше 5 минут. */
function sameGroup(a: { from_staff: boolean; created_at: string }, b: { from_staff: boolean; created_at: string }) {
  return (
    a.from_staff === b.from_staff &&
    dayKey(a.created_at) === dayKey(b.created_at) &&
    Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < GROUP_GAP_MS
  );
}

/** Окно диалога: история с подгрузкой старых, разделители дней, поле ввода. */
export function ChatView({
  source, emptyHint, header, notice, className, composerClassName, peerAvatar, quickReplies,
}: ChatViewProps) {
  const { t } = useTranslation();
  const chat = useChat(source);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const prevHeightRef = useRef<number | null>(null);

  // держим прокрутку внизу, если пользователь и так был внизу; при подгрузке старых — сохраняем позицию
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prevHeightRef.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
      prevHeightRef.current = null;
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chat.messages, chat.pending, chat.loading]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = () => {
    prevHeightRef.current = listRef.current?.scrollHeight ?? null;
    chat.loadOlder().catch(() => {
      prevHeightRef.current = null;
      toast.error(t("support.loadFailed"));
    });
  };

  const send = (body: string) => {
    stickRef.current = true;
    chat.send(body).catch((e: unknown) => toast.error(serverMessages(e)[0] ?? t("support.sendFailed")));
  };

  const empty = !chat.loading && chat.messages.length === 0 && chat.pending.length === 0;

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-background", className)}>
      {typeof header === "function" ? header({ status: chat.status, staffOnline: chat.staffOnline }) : header}
      {notice?.(chat.status)}
      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/30 px-2.5 py-3 sm:px-4" aria-live="polite">
        {chat.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-10 w-1/2" />
            <Skeleton className="h-16 w-3/5" />
          </div>
        ) : chat.error ? (
          <ErrorState error={chat.error} onRetry={() => window.location.reload()} />
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
            {emptyHint}
          </div>
        ) : (
          <>
            {chat.hasMore && (
              <div className="flex justify-center pb-2">
                <Button variant="ghost" size="sm" onClick={loadOlder} disabled={chat.loadingOlder}>
                  {chat.loadingOlder && <Loader2 className="animate-spin" aria-hidden />}
                  {t("support.older")}
                </Button>
              </div>
            )}
            <ul aria-label={t("support.history")}>
              {chat.messages.map((m, i) => {
                const prev = chat.messages[i - 1];
                const next = chat.messages[i + 1];
                const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                const mine = m.from_staff === source.staff;
                // своё последнее сообщение продолжает серия «отправляется…»
                const continued = next ? sameGroup(m, next) : mine && chat.pending.length > 0;
                const pos = { first: newDay || !prev || !sameGroup(prev, m), last: !continued };
                return (
                  <Fragment key={m.id}>
                    {newDay && <DayLabel iso={m.created_at} />}
                    <MessageRow message={m} mine={mine} showAuthor={source.staff} pos={pos} avatar={peerAvatar} />
                  </Fragment>
                );
              })}
              {chat.pending.map((p, i) => (
                <PendingRow
                  key={p.tempId}
                  pos={{
                    first: i === 0 && !(chat.messages.length > 0 && chat.messages[chat.messages.length - 1].from_staff === source.staff),
                    last: i === chat.pending.length - 1,
                  }}
                  item={p}
                  onRetry={() => void chat.retry(p.tempId).catch(() => toast.error(t("support.sendFailed")))}
                  onDiscard={() => chat.discard(p.tempId)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
      <Composer
        className={composerClassName}
        onSend={send}
        disabled={chat.loading || Boolean(chat.error)}
        placeholder={source.staff ? t("support.replyPlaceholder") : t("support.placeholder")}
        quickReplies={quickReplies}
      />
    </div>
  );
}
