import { ArrowLeft, CheckCircle2, MessagesSquare, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Avatar } from "@/components/common/avatar";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { RoleBadge } from "@/components/layout/user-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  adminThreadApi, useMyPresence, useSetPresence, useSetThreadStatus, useSupportStats, useSupportThread, useSupportThreads,
  type SupportThread, type ThreadFilters,
} from "@/api/support";
import { useFormat } from "@/lib/format";
import { useUrlState } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { ChatView } from "@/features/support/chat-view";
import type { ChatSource } from "@/features/support/use-chat";

type Filter = "open" | "closed";
const FILTERS: Filter[] = ["open", "closed"];

function toQuery(filter: Filter): ThreadFilters {
  return { search: "", unread: "", status: filter };
}

function displayName(t: SupportThread) {
  return t.user_name || t.user_email || t.user_phone || `#${t.user_id}`;
}

function shortTime(iso: string, fmt: ReturnType<typeof useFormat>) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : fmt.date(iso);
}

/** Мой статус в чате: пользователи видят «Поддержка в сети», пока кто-то из сотрудников в сети. */
function PresenceToggle() {
  const { t } = useTranslation();
  const presence = useMyPresence();
  const setPresence = useSetPresence();
  const online = presence.data?.status === "online";

  const toggle = () =>
    setPresence.mutate(online ? "offline" : "online", {
      onError: () => toast.error(t("support.admin.presenceFailed")),
    });

  return (
    <button
      type="button"
      role="switch"
      aria-checked={online}
      onClick={toggle}
      disabled={presence.isPending || setPresence.isPending}
      title={t("support.admin.presenceHint")}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-60",
        online ? "border-success/40 bg-success-soft" : "border-border bg-muted/40 hover:bg-muted",
      )}
    >
      <span className={cn("size-2.5 shrink-0 rounded-full", online ? "bg-success shadow-[0_0_0_3px] shadow-success/20" : "bg-muted-foreground/50")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium", online ? "text-success" : "text-foreground")}>
          {online ? t("support.online") : t("support.offline")}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {online ? t("support.admin.onlineHint") : t("support.admin.offlineHint")}
        </span>
      </span>
      {/* сам переключатель */}
      <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", online ? "bg-success" : "bg-muted-foreground/30")} aria-hidden>
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left]", online ? "left-[18px]" : "left-0.5")} />
      </span>
    </button>
  );
}

/** Счётчики смены: сколько ждут ответа и сколько закрыто сегодня (обнуляется после 23:59). */
function StatsBar() {
  const { t } = useTranslation();
  const stats = useSupportStats();
  const items = [
    { key: "toAnswer", value: stats.data?.to_answer, tone: "text-warning" },
    { key: "closedToday", value: stats.data?.closed_today, tone: "text-success" },
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-2" aria-label={t("support.admin.stats.title")}>
      {items.map((it) => (
        <div key={it.key} className="rounded-xl border border-border bg-muted/40 px-3 py-2">
          <p className={cn("text-xl font-semibold leading-none tabular-nums", it.tone)}>{it.value ?? "–"}</p>
          <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{t(`support.admin.stats.${it.key}`)}</p>
        </div>
      ))}
    </div>
  );
}

function ThreadList({ selected, onSelect }: { selected: number | undefined; onSelect: (id: number) => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [filter, setFilter] = useState<Filter>("open");
  const query = useSupportThreads(toQuery(filter));
  const rows = query.data?.results ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card lg:rounded-2xl lg:border lg:border-border">
      <div className="space-y-2 border-b border-border px-3 py-2.5">
        <PresenceToggle />
        <StatsBar />
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1 [scrollbar-width:none]" role="radiogroup" aria-label={t("support.admin.filter")}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "h-8 flex-1 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition-colors",
                filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`support.admin.filters.${f}`)}
            </button>
          ))}
        </div>
      </div>
      {/* на телефоне низ списка не прячется под плавающее меню */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24 lg:pb-0">
        {query.isPending ? (
          <div className="p-3">
            <ListSkeleton rows={4} />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : rows.length === 0 ? (
          <EmptyState illustration="search" title={t("support.admin.empty")} className="py-8" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const name = displayName(row);
              const active = row.id === selected;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "relative flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted",
                      active &&
                        "bg-accent hover:bg-accent before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary",
                    )}
                  >
                    <Avatar name={name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={cn("truncate text-sm", row.unread > 0 ? "font-semibold" : "font-medium")}>{name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{shortTime(row.last_message_at, fmt)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={cn("line-clamp-1 flex-1 text-xs", row.unread > 0 ? "text-foreground" : "text-muted-foreground")}>
                          {row.last_from_staff && <span className="text-muted-foreground">{t("support.admin.you")}: </span>}
                          {row.last_body}
                        </span>
                        {row.unread > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
                            {row.unread}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <RoleBadge role={row.user_role} />
                        {row.status === "closed" && <Badge>{t("support.admin.closed")}</Badge>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ThreadHeader({ thread, onBack }: { thread: SupportThread; onBack: () => void }) {
  const { t } = useTranslation();
  const setStatus = useSetThreadStatus();
  const closed = thread.status === "closed";
  const contacts = [thread.user_email, thread.user_phone].filter(Boolean).join(" · ");

  const toggle = async () => {
    try {
      await setStatus.mutateAsync({ id: thread.id, status: closed ? "open" : "closed" });
      toast.success(closed ? t("support.admin.reopened") : t("support.admin.closedToast"));
    } catch {
      toast.error(t("support.admin.statusFailed"));
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-1.5 py-1.5 sm:gap-3 sm:px-3 sm:py-2">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} aria-label={t("common.back")}>
        <ArrowLeft aria-hidden />
      </Button>
      <Avatar name={displayName(thread)} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-semibold">
          {displayName(thread)}
          <RoleBadge role={thread.user_role} />
        </p>
        {contacts && <p className="truncate text-xs text-muted-foreground">{contacts}</p>}
      </div>
      <Button variant="secondary" size="sm" onClick={() => void toggle()} disabled={setStatus.isPending}>
        {closed ? <RotateCcw aria-hidden /> : <CheckCircle2 aria-hidden />}
        <span className="hidden sm:inline">{closed ? t("support.admin.reopen") : t("support.admin.close")}</span>
      </Button>
    </div>
  );
}

function ThreadChat({ id, onBack }: { id: number; onBack: () => void }) {
  const { t } = useTranslation();
  const thread = useSupportThread(id);
  const source = useMemo<ChatSource>(() => {
    const api = adminThreadApi(id);
    return {
      key: `thread-${id}`,
      staff: true,
      ...api,
      invalidate: [["admin-support"]],
    };
  }, [id]);

  const quickReplies = useMemo(
    () => [
      t("support.admin.quick.hello"),
      t("support.admin.quick.checking"),
      t("support.admin.quick.details"),
      t("support.admin.quick.done"),
    ],
    [t],
  );

  return (
    <div className="flex min-h-0 flex-1">
    <ChatView
      source={source}
      quickReplies={thread.data?.status === "closed" ? undefined : quickReplies}
      peerAvatar={thread.data ? <Avatar name={displayName(thread.data)} size="sm" /> : undefined}
      className="min-h-0 min-w-0 flex-1 rounded-none border-0"
      composerClassName="pb-[calc(5.75rem+env(safe-area-inset-bottom))] lg:pb-2.5"
      header={thread.data ? <ThreadHeader thread={thread.data} onBack={onBack} /> : <div className="h-14 shrink-0 border-b border-border bg-card" />}
      notice={() =>
        thread.data?.status === "closed" ? (
          <p className="border-b border-border bg-muted/60 px-4 py-2 text-xs text-muted-foreground">{t("support.admin.closedNotice")}</p>
        ) : null
      }
      emptyHint={t("support.admin.noMessages")}
    />
    {thread.data && <ClientPanel thread={thread.data} />}
    </div>
  );
}

/** Данные клиента справа от переписки (на широких экранах). */
function ClientPanel({ thread }: { thread: SupportThread }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const none = t("support.admin.client.none");
  const rows: [string, string][] = [
    [t("support.admin.client.email"), thread.user_email || none],
    [t("support.admin.client.phone"), thread.user_phone || none],
    [t("support.admin.client.status"), thread.status === "closed" ? t("support.admin.client.statusClosed") : t("support.admin.client.statusOpen")],
    [t("support.admin.client.since"), fmt.date(thread.created_at)],
    [t("support.admin.client.last"), fmt.date(thread.last_message_at)],
    [t("support.admin.client.unread"), String(thread.unread)],
  ];
  return (
    <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-l border-border bg-card xl:flex" aria-label={t("support.admin.client.title")}>
      <div className="flex flex-col items-center gap-1.5 border-b border-border px-3 py-4 text-center">
        <Avatar name={displayName(thread)} size="sm" />
        <p className="text-sm font-semibold break-words">{displayName(thread)}</p>
        <RoleBadge role={thread.user_role} />
      </div>
      <dl className="space-y-2.5 px-3 py-3 text-xs">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/** Чат с пользователями: список диалогов слева, переписка справа; на телефоне — по очереди. */
export function AdminSupportTab() {
  const { t } = useTranslation();
  const { values, set } = useUrlState(["thread"] as const);
  const selected = Number(values.thread) || undefined;

  return (
    // на весь экран: оболочка убирает у этой страницы поля; слева диалоги, справа переписка
    <div className="grid min-h-0 w-full flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
      <div className={cn("min-h-0", selected ? "hidden lg:flex lg:flex-col" : "flex flex-col")}>
        <ThreadList selected={selected} onSelect={(id) => set("thread", id)} />
      </div>
      <div className={cn("min-h-0 min-w-0 flex-col", selected ? "flex" : "hidden lg:flex")}>
        {selected ? (
          <ThreadChat key={selected} id={selected} onBack={() => set("thread", null)} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-muted/30 px-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <MessagesSquare className="size-7" aria-hidden />
            </span>
            <div className="space-y-1">
              <p className="font-medium">{t("support.admin.pick")}</p>
              <p className="max-w-xs text-sm text-muted-foreground">{t("support.admin.pickHint")}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
