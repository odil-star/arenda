import { CheckCircle2, Copy, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { serverMessages } from "@/api/errors";
import { useTenantLinkCode } from "@/api/hooks";
import type { Tenant } from "@/api/types";
import { useFormat } from "@/lib/format";

/** Привязка Telegram: арендатор отправляет боту одноразовый код и получает напоминания об оплате. */
export function TelegramLink({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const linkCode = useTenantLinkCode();

  if (tenant.telegram_linked) {
    return (
      <p className="mt-5 flex items-center gap-2 rounded-lg bg-success-soft p-3 text-sm text-success">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden />
        {t("tenants.telegramLinked")}
      </p>
    );
  }

  const generate = async () => {
    try {
      await linkCode.mutateAsync(tenant.id);
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
    }
  };

  const copy = async (value: string, message: "tenants.codeCopied" | "tenants.linkCopied" = "tenants.codeCopied") => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t(message));
    } catch {
      toast.error(t("errors.actionFailed"));
    }
  };

  return (
    <section className="mt-5 space-y-3 rounded-lg border border-border p-3" aria-labelledby="tg-title">
      <div className="flex items-start gap-2.5">
        <Send className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <h3 id="tg-title" className="text-sm font-medium">{t("tenants.telegramTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("tenants.telegramHint")}</p>
        </div>
      </div>
      {linkCode.data ? (
        <div className="space-y-2" aria-live="polite">
        {linkCode.data.bot_url && (
          <Button size="sm" onClick={() => void copy(linkCode.data!.bot_url!, "tenants.linkCopied")}>
            <Copy aria-hidden /> {t("tenants.copyLink")}
          </Button>
        )}
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
          <div>
            <p className="font-mono text-lg font-semibold tracking-wider">{linkCode.data.code}</p>
            <p className="text-xs text-muted-foreground">
              {t("tenants.codeExpires", { date: fmt.date(linkCode.data.expires_at.slice(0, 10)) })}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void copy(linkCode.data.code)} aria-label={t("tenants.copyCode")}>
            <Copy aria-hidden />
          </Button>
        </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" loading={linkCode.isPending} onClick={() => void generate()}>
          {t("tenants.getCode")}
        </Button>
      )}
    </section>
  );
}
