import { CheckCircle2, Copy, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { serverMessages } from "@/api/errors";
import { copyText } from "@/lib/clipboard";
import { useFormat } from "@/lib/format";

interface TelegramCardProps {
  linked: boolean;
  requestCode: () => Promise<{ code: string; expires_at: string; bot_url?: string | null }>;
  /** Перезапросить профиль: пока ждём привязку, карточка опрашивает его и сама переключается на «подключено» */
  refresh?: () => unknown;
  unlink: () => Promise<unknown>;
  busy?: boolean;
  /** Без заголовка и рамки — когда карточка вложена в раскрывающийся раздел */
  bare?: boolean;
}

/** Привязка Telegram в профиле (одинаково для арендодателя, админа и жильца): код → бот → напоминания. */
export function TelegramCard({ linked, requestCode, refresh, unlink, busy, bare }: TelegramCardProps) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [code, setCode] = useState<{ code: string; expires_at: string; bot_url?: string | null } | null>(null);
  const wasWaiting = useRef(false);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fail = (error: unknown) => toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));

  // Ждём, пока бот подтвердит привязку: раз в 3 секунды обновляем профиль (не дольше срока кода).
  useEffect(() => {
    if (!code || linked || !refresh) return;
    wasWaiting.current = true;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [code, linked, refresh]);

  useEffect(() => {
    if (linked && wasWaiting.current) {
      wasWaiting.current = false;
      setCode(null);
      toast.success(t("profile.telegramConnected"));
    }
  }, [linked, t]);

  const generate = async () => {
    // Окно открываем сразу по клику: после await браузер счёл бы его всплывающим и заблокировал.
    const popup = window.open("", "_blank");
    setLoading(true);
    try {
      const next = await requestCode();
      setCode(next);
      if (next.bot_url) {
        if (popup) popup.location.href = next.bot_url;
        else window.location.href = next.bot_url;
      } else popup?.close();
    } catch (error) {
      popup?.close();
      fail(error);
    } finally {
      setLoading(false);
    }
  };

  const copy = async (value: string) => {
    const ok = await copyText(value);
    if (ok) toast.success(t("tenants.codeCopied"));
    else toast.error(t("errors.actionFailed"));
  };

  const doUnlink = async () => {
    try {
      await unlink();
      setCode(null);
      setConfirmOpen(false);
      toast.success(t("profile.telegramUnlinked"));
    } catch (error) {
      fail(error);
    }
  };

  return (
    <section aria-labelledby={bare ? undefined : "tg-h"} aria-label={bare ? t("profile.telegramTitle") : undefined} className="space-y-2">
      {!bare && <h2 id="tg-h" className="text-base font-semibold">{t("profile.telegramTitle")}</h2>}
      <div className={bare ? "space-y-3" : "space-y-3 rounded-xl border border-border bg-card p-5"}>
        {linked ? (
          <>
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              {t("profile.telegramLinked")}
            </p>
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(true)}>
              {t("profile.telegramUnlink")}
            </Button>
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title={t("profile.telegramUnlinkTitle")}
              description={t("profile.telegramUnlinkHint")}
              confirmLabel={t("profile.telegramUnlink")}
              loading={busy}
              onConfirm={() => void doUnlink()}
            />
          </>
        ) : (
          <>
            <div className="flex items-start gap-2.5">
              <Send className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">{t("profile.telegramHint")}</p>
            </div>
            {code ? (
              <div className="space-y-3" aria-live="polite">
                {code.bot_url && (
                  <>
                    <p className="text-sm text-muted-foreground">{t("profile.telegramWaiting")}</p>
                    <Button asChild size="sm">
                      <a href={code.bot_url} target="_blank" rel="noreferrer">
                        <Send aria-hidden /> {t("profile.telegramOpen")}
                      </a>
                    </Button>
                  </>
                )}
                <p className="text-xs text-muted-foreground">{t("profile.telegramManual")}</p>
                <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
                  <div>
                    <p className="font-mono text-lg font-semibold tracking-wider">{code.code}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("tenants.codeExpires", { date: fmt.date(code.expires_at.slice(0, 10)) })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("tenants.copyCode")}
                    onClick={() => void copy(code.code)}
                  >
                    <Copy aria-hidden />
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" loading={loading} onClick={() => void generate()}>
                <Send aria-hidden /> {t("profile.telegramConnect")}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
