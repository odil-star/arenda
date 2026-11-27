import { Gauge, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { METER_KINDS, useLandlordMeters, useRepairs, type MeterEntry } from "@/api/requests";
import { RepairStatusBadge } from "@/features/cabinet/services-tab";
import { useFormat } from "@/lib/format";

/** Показания счётчиков и заявки на ремонт, которые жилец передал по этому объекту. */
export function PropertyRequests({ propertyId }: { propertyId: number }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const meters = useLandlordMeters(propertyId);
  const repairs = useRepairs(undefined, propertyId);

  const byKind = (kind: string): MeterEntry[] =>
    (meters.data ?? []).filter((m) => m.kind === kind).sort((a, b) => b.period.localeCompare(a.period));
  const rows = METER_KINDS.map((k) => ({ kind: k, list: byKind(k) })).filter((r) => r.list.length > 0);
  const recent = (repairs.data ?? []).slice(0, 5);

  if (meters.isPending || repairs.isPending) return <Skeleton className="h-32 rounded-xl" />;
  if (rows.length === 0 && recent.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{t("propertyHub.requests")}</CardTitle>
        <Link to="/requests" className="text-sm font-medium text-primary hover:underline">
          {t("propertyHub.allRequests")}
        </Link>
      </CardHeader>
      <CardContent className="space-y-5">
        {rows.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Gauge className="size-4" aria-hidden /> {t("services.meters")}
            </h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map(({ kind, list }) => {
                const [last, prev] = list;
                return (
                  <li key={kind} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{t(`services.meter.${kind}`)}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmt.month(last.period)} · {last.tenant_name}
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="font-semibold">{fmt.number(last.value)}</p>
                      {prev && <p className="text-xs text-muted-foreground">+{fmt.number(last.value - prev.value)}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {recent.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Wrench className="size-4" aria-hidden /> {t("requests.tabRepairs")}
            </h3>
            <ul className="space-y-2">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {r.title} <span className="text-muted-foreground">· {fmt.date(r.created_at.slice(0, 10))}</span>
                  </span>
                  <RepairStatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
