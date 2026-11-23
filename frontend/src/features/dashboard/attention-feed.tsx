import { AlertCircle, Building2, CalendarClock, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { leasesApi, paymentsApi } from "@/api/hooks";
import type { Dashboard } from "@/api/types";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Item {
  key: string;
  to: string;
  icon: LucideIcon;
  tone: "danger" | "warning";
  title: string;
  text: string;
  /** чем больше, тем срочнее */
  score: number;
}

const LIMIT = 6;

/** Один список «что требует внимания»: просрочки, договоры к продлению, простаивающие объекты. */
export function AttentionFeed({ data, propertyId }: { data: Dashboard; propertyId: number | null }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const overdue = paymentsApi.useList({ status: "overdue", ordering: "due_date", page_size: 20 });
  const leases = leasesApi.useList({ status: "active", ordering: "end_date", page_size: 20 });

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const p of overdue.data?.results ?? []) {
      if (propertyId && p.property !== propertyId) continue;
      const days = fmt.daysFromToday(p.due_date);
      out.push({
        key: `p${p.id}`,
        to: "/payments?tab=overdue",
        icon: AlertCircle,
        tone: "danger",
        title: `${p.property_name} · ${p.tenant_name}`,
        text: t("dashboard.attention.overdue", { amount: fmt.money(p.remaining), count: days }),
        score: 1000 + days,
      });
    }
    for (const l of leases.data?.results ?? []) {
      if (propertyId && l.property !== propertyId) continue;
      const left = -fmt.daysFromToday(l.end_date);
      if (left < 0 || left > 30) continue;
      out.push({
        key: `l${l.id}`,
        to: `/leases/${l.id}`,
        icon: CalendarClock,
        tone: left <= 7 ? "danger" : "warning",
        title: `${l.property_name} · ${l.tenant_name}`,
        text: left === 0 ? t("dashboard.endsToday") : t("dashboard.endsIn", { count: left }),
        score: 500 - left,
      });
    }
    for (const v of data.vacant_properties ?? []) {
      if (propertyId && v.id !== propertyId) continue;
      if (v.days <= 7) continue;
      out.push({
        key: `v${v.id}`,
        to: `/properties/${v.id}`,
        icon: Building2,
        tone: "warning",
        title: v.name,
        text: t("dashboard.insights.vacantDays", { count: v.days }),
        score: Math.min(v.days, 300),
      });
    }
    return out.sort((a, b) => b.score - a.score);
  }, [overdue.data, leases.data, data.vacant_properties, propertyId, t, fmt]);

  if (items.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{t("dashboard.attention.title")}</CardTitle>
        <span className="text-xs text-muted-foreground tabular">{items.length}</span>
      </CardHeader>
      <ul className="mt-3 divide-y divide-border border-t border-border">
        {items.slice(0, LIMIT).map((i) => (
          <li key={i.key}>
            <Link to={i.to} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 sm:px-5">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  i.tone === "danger" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
                )}
              >
                <i.icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{i.title}</p>
                <p className={cn("truncate text-xs", i.tone === "danger" ? "text-danger" : "text-warning")}>{i.text}</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
