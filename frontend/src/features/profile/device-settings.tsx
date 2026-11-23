import { Bell, BellOff, Download, Fingerprint, Share, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isCancelled, passkeysSupported, useAddPasskey, usePasskeys, useRemovePasskey } from "@/lib/passkeys";
import { useFormat } from "@/lib/format";
import { useInstallPrompt, usePush } from "@/lib/pwa";

/** Устройства для входа по отпечатку / Face ID. */
function PasskeySettings() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const list = usePasskeys();
  const add = useAddPasskey();
  const remove = useRemovePasskey();
  if (!passkeysSupported()) return <p className="text-sm text-muted-foreground">{t("passkey.unsupported")}</p>;

  const onAdd = async () => {
    try {
      await add.mutateAsync(navigator.platform || "");
      toast.success(t("passkey.added"));
    } catch (error) {
      if (!isCancelled(error)) toast.error(t("passkey.addFailed"));
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("passkey.title")}</p>
      <p className="text-sm text-muted-foreground">{t("passkey.hint")}</p>
      {list.data && list.data.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.data.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2">
              <Fingerprint className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{k.name || t("passkey.device")}</p>
                <p className="text-xs text-muted-foreground">
                  {k.last_used_at ? t("passkey.lastUsed", { date: fmt.date(k.last_used_at) }) : t("passkey.createdOn", { date: fmt.date(k.created_at) })}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" aria-label={t("passkey.remove")} loading={remove.isPending && remove.variables === k.id}
                onClick={() => remove.mutate(k.id, { onError: () => toast.error(t("errors.actionFailed")) })}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="secondary" className="w-full" loading={add.isPending} onClick={() => void onAdd()}>
        <Fingerprint aria-hidden /> {t("passkey.add")}
      </Button>
    </div>
  );
}

/** Установка приложения на телефон, вход по отпечатку и push: общий блок для жильца и арендодателя. */
export function DeviceSettings() {
  const { t } = useTranslation();
  const install = useInstallPrompt();
  const push = usePush();

  const togglePush = async () => {
    try {
      if (push.state === "on") await push.disable();
      else await push.enable();
    } catch {
      toast.error(t("errors.actionFailed"));
    }
  };

  return (
    <div className="space-y-4">
      <PasskeySettings />
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("pwa.installTitle")}</p>
        {install.installed ? (
          <p className="text-sm text-muted-foreground">{t("pwa.installed")}</p>
        ) : install.canInstall ? (
          <>
            <p className="text-sm text-muted-foreground">{t("pwa.installHint")}</p>
            <Button type="button" variant="secondary" className="w-full" onClick={() => void install.install()}>
              <Download aria-hidden /> {t("pwa.install")}
            </Button>
          </>
        ) : install.needsIosHint ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Share className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("pwa.iosHint")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("pwa.installMenu")}</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t("pwa.pushTitle")}</p>
        {push.state === "loading" ? null : push.state === "unsupported" || push.state === "disabled" ? (
          <p className="text-sm text-muted-foreground">{t(push.state === "disabled" ? "pwa.pushDisabled" : "pwa.pushUnsupported")}</p>
        ) : push.state === "blocked" ? (
          <p className="text-sm text-muted-foreground">{t("pwa.pushBlocked")}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("pwa.pushHint")}</p>
            <Button
              type="button"
              variant={push.state === "on" ? "ghost" : "secondary"}
              className="w-full"
              loading={push.busy}
              onClick={() => void togglePush()}
            >
              {push.state === "on" ? <BellOff aria-hidden /> : <Bell aria-hidden />}
              {t(push.state === "on" ? "pwa.pushOff" : "pwa.pushOn")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
