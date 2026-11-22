import { Copy } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { serverMessages } from "@/api/errors";
import { useInviteQr, usePropertyInvite } from "@/api/hooks";
import type { Property } from "@/api/types";
import { useFormat } from "@/lib/format";

interface Props {
  property: Property | null;
  onClose: () => void;
}

/** Приглашение жильца в объект: одноразовая ссылка и QR. Каждое создание отзывает прежнюю ссылку. */
export function InviteDialog({ property, onClose }: Props) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const invite = usePropertyInvite();
  const qr = useInviteQr(property?.id ?? 0, invite.data?.url);
  const { reset } = invite;

  useEffect(() => {
    reset(); // при смене объекта не показываем чужую ссылку
  }, [property?.id, reset]);

  const create = async () => {
    if (!property) return;
    try {
      await invite.mutateAsync(property.id);
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("properties.invite.copied"));
    } catch {
      toast.error(t("errors.actionFailed"));
    }
  };

  const data = invite.data;
  return (
    <Dialog open={property !== null} onOpenChange={(o) => !o && onClose()}>
      {property && (
        <DialogContent
          title={`${t("properties.invite.title")}: ${property.name}`}
          description={t("properties.invite.description")}
        >
          <div className="space-y-4">
            {data && (
              <div className="space-y-3" aria-live="polite">
                <p className="text-sm font-medium">{t("properties.invite.link")}</p>
                <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                  <p className="min-w-0 flex-1 break-all font-mono text-xs">{data.url}</p>
                  <Button variant="ghost" size="icon" onClick={() => void copy(data.url)} aria-label={t("properties.invite.copy")}>
                    <Copy aria-hidden />
                  </Button>
                </div>
                {qr.data && (
                  <img src={qr.data} alt={t("properties.invite.qrAlt")} className="mx-auto size-48 rounded-md bg-white p-2" />
                )}
                <p className="text-xs text-muted-foreground">
                  {t("properties.invite.expires", { date: fmt.date(data.expires_at.slice(0, 10)) })}
                </p>
                <p className="text-xs text-muted-foreground">{t("properties.invite.hint")}</p>
              </div>
            )}
            <Button variant={data ? "secondary" : "primary"} loading={invite.isPending} onClick={() => void create()}>
              {data ? t("properties.invite.regenerate") : t("properties.invite.create")}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
