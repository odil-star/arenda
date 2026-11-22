import { CalendarClock, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { leasesApi } from "@/api/hooks";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

const WINDOW_DAYS = 30;

/**
 * Действующие договоры, которые заканчиваются в ближайшие 30 дней:
 * пора договориться о продлении или искать нового арендатора.
 * Карточка не показывается, если таких договоров нет.
 */
export function ExpiringList({ className }: { className?: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = leasesApi.useList({ status: "active", ordering: "end_date", page_size: 20 });

  const items = (query.data?.results ?? []).filter((l) => {
    const left = -fmt.daysFromToday(l.end_date);
    return left >= 0 && left <= WINDOW_DAYS;
  });

  if (items.length === 0) return null;

  return (
    <Card id="expiring" className={cn("overflow-hidden", className)}>
      <CardHeader>
        <CardTitle>{t("dashboard.expiringList")}</CardTitle>
      </CardHeader>
      <ul className="mt-3 divide-y divide-border border-t border-border">
        {items.map((l) => {
          const left = -fmt.daysFromToday(l.end_date);
          const urgent = left <= 7;
          return (
            <li key={l.id}>
              <Link
                to={`/leases/${l.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 sm:px-5"
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    urgent ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
                  )}
                >
                  <CalendarClock className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.property_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{l.tenant_name}</p>
                </div>
                <div className="text-right">
                  <p className={cn("text-xs font-medium tabular", urgent ? "text-danger" : "text-warning")}>
                    {left === 0 ? t("dashboard.endsToday") : t("dashboard.endsIn", { count: left })}
                  </p>
                  <p className="text-xs text-muted-foreground tabular">{fmt.date(l.end_date)}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
