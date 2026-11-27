import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { FormAlert } from "@/components/common/form-field";
import { useMe } from "@/api/hooks";
import { errorKind } from "@/api/errors";
import { useTenantScreening, type Verdict } from "@/api/screening";
import type { Tenant } from "@/api/types";
import { hasTier } from "@/features/profile/tiers";

const TONE: Record<Verdict, BadgeTone> = { reliable: "success", mostly: "info", risky: "danger", not_enough: "neutral" };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-display text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Body({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation();
  const query = useTenantScreening(tenant.id, true);
  if (query.isPending) return <Skeleton className="h-32 w-full" />;
  if (query.isError) return <FormAlert messages={[t(`errors.${errorKind(query.error)}.description`)]} />;
  const r = query.data;
  if (r.status !== "ok") return <p className="text-sm text-muted-foreground">{t(`screening.${r.status}`)}</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[r.verdict]}>{t(`screening.verdict.${r.verdict}`)}</Badge>
        <span className="text-sm text-muted-foreground">{t("screening.history", { months: r.months, leases: r.leases, landlords: r.landlords })}</span>
      </div>
      <p className="text-sm">{t(`screening.verdictText.${r.verdict}`)}</p>
      <dl className="grid grid-cols-3 gap-2">
        <Stat label={t("screening.onTime", { days: r.grace_days })} value={r.on_time} />
        <Stat label={t("screening.late")} value={r.late} />
        <Stat label={t("screening.overdue")} value={r.overdue} />
      </dl>
    </div>
  );
}

/** VIP: проверка жильца. Запрос идёт только после открытия окна, на Free показываем, что функция закрыта. */
export function ScreeningDialog({ tenant, onClose }: { tenant: Tenant | null; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const vip = hasTier(me.data?.subscription, "vip");
  return (
    <Dialog open={tenant !== null} onOpenChange={(o) => !o && onClose()}>
      {tenant && (
        <DialogContent
          title={
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-5" aria-hidden /> {t("screening.title")}
            </span>
          }
          description={tenant.full_name}
          footer={<Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>}
        >
          {vip ? <Body tenant={tenant} /> : <p className="text-sm text-muted-foreground">{t("screening.locked")}</p>}
          <p className="mt-4 text-xs text-muted-foreground">{t("screening.privacy")}</p>
        </DialogContent>
      )}
    </Dialog>
  );
}
