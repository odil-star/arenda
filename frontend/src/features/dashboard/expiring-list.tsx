import { addYears, format, parseISO } from "date-fns";
import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { serverMessages } from "@/api/errors";
import { leasesApi, useExtendLease } from "@/api/hooks";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

const WINDOW_DAYS = 30;

/**
 * Действующие договоры, которые заканчиваются в ближайшие 30 дней:
 * пора договориться о продлении или искать нового арендатора.
 * Карточка не показывается, если таких договоров нет.
 */
export function ExpiringList({ className, propertyId = null }: { className?: string; propertyId?: number | null }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = leasesApi.useList({ status: "active", ordering: "end_date", page_size: 20 });
  const extend = useExtendLease();

  const items = (query.data?.results ?? []).filter((l) => {
    const left = -fmt.daysFromToday(l.end_date);
    return left >= 0 && left <= WINDOW_DAYS && (!propertyId || l.property === propertyId);
  });

  /** Продлить на год с тем же условиями: новая дата окончания = старая + 12 месяцев. */
  const onExtend = async (id: number, end: string) => {
    try {
      await extend.mutateAsync({ id, end_date: format(addYears(parseISO(end), 1), "yyyy-MM-dd") });
      toast.success(t("dashboard.extended"));
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
    }
  };

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
            <li key={l.id} className="flex items-center transition-colors hover:bg-muted/60">
              <Link to={`/leases/${l.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 sm:pl-5">
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
              </Link>
              <Button
                size="sm"
                variant="secondary"
                className="mx-3 shrink-0 sm:mx-5"
                loading={extend.isPending && extend.variables?.id === l.id}
                onClick={() => void onExtend(l.id, l.end_date)}
              >
                {t("dashboard.extend")}
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
