import { ArrowLeft, Headset } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supportUserApi } from "@/api/support";
import { cn } from "@/lib/utils";
import { ChatView } from "./chat-view";
import type { ChatSource } from "./use-chat";

function useUserSource(): ChatSource {
  return useMemo(
    () => ({
      key: "me",
      staff: false,
      messages: supportUserApi.messages,
      send: supportUserApi.send,
      read: supportUserApi.read,
      invalidate: [["support", "unread"]],
    }),
    [],
  );
}

function EmptyHint() {
  const { t } = useTranslation();
  return (
    <>
      <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Headset className="size-6" aria-hidden />
      </span>
      <p className="font-medium text-foreground">{t("support.emptyTitle")}</p>
      <p className="max-w-xs">{t("support.emptyText")}</p>
    </>
  );
}

function ClosedNotice({ status }: { status: string | null }) {
  const { t } = useTranslation();
  if (status !== "closed") return null;
  return <p className="border-b border-border bg-muted/60 px-4 py-2 text-xs text-muted-foreground">{t("support.closedUser")}</p>;
}

/** Шапка чата пользователя: «Поддержка» и в сети ли она сейчас. */
function SupportHeader({ online, back }: { online: boolean | null; back?: "cabinet" | "history" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:px-4">
      {back === "cabinet" && (
        <Button variant="ghost" size="icon" asChild aria-label={t("common.back")}>
          <Link to="/cabinet" replace>
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
      )}
      {back === "history" && (
        // арендодатель: на телефоне нижнего меню в чате нет, возвращаемся туда, откуда пришли
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={t("common.back")}
          onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/"))}
        >
          <ArrowLeft aria-hidden />
        </Button>
      )}
      <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Headset className="size-[18px]" aria-hidden />
        {online !== null && (
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card",
              online ? "bg-success" : "bg-muted-foreground/50",
            )}
            aria-hidden
          />
        )}
      </span>
      <div className="min-w-0">
        <h1 className="text-sm font-semibold leading-tight">{t("support.title")}</h1>
        {online !== null && (
          <p className={cn("truncate text-xs", online ? "text-success" : "text-muted-foreground")}>
            {online ? t("support.userOnline") : t("support.userOffline")}
          </p>
        )}
      </div>
    </div>
  );
}

function UserChat({ className, composerClassName, back }: { className: string; composerClassName?: string; back?: "cabinet" | "history" }) {
  const source = useUserSource();
  return (
    <ChatView
      source={source}
      header={({ staffOnline }) => <SupportHeader online={staffOnline} back={back} />}
      emptyHint={<EmptyHint />}
      notice={(status) => <ClosedNotice status={status} />}
      className={className}
      composerClassName={composerClassName}
    />
  );
}

/**
 * Арендодатель: чат на всю рабочую область — оболочка убирает у этой страницы поля и ограничение ширины.
 * В чате нижнее меню скрыто (см. AppShell), поэтому поле ввода прижато к низу экрана.
 */
export function SupportPage() {
  return (
    <UserChat
      back="history"
      className="h-full rounded-none border-0"
      composerClassName="pb-[max(0.625rem,env(safe-area-inset-bottom))]"
    />
  );
}

/** Жилец: отдельный полноэкранный экран кабинета. */
export function CabinetSupportPage() {
  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col sm:border-x sm:border-border">
      <UserChat
        back="cabinet"
        className="min-h-0 flex-1 rounded-none border-0"
        composerClassName="pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      />
    </div>
  );
}
