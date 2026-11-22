import { addDays, format } from "date-fns";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/common/avatar";
import { Parties } from "@/components/common/entity-names";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { paymentsApi } from "@/api/hooks";
import type { Payment } from "@/api/types";
import { PayDialog } from "@/features/payments/pay-dialog";
import { todayISO, useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

const LIMIT = 5;

/** Платежи со сроком в ближайшие 7 дней, ещё не закрытые полностью. */
export function UpcomingList({ className }: { className?: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [paying, setPaying] = useState<Payment | null>(null);
  const query = paymentsApi.useList({
    due_from: todayISO(),
    due_to: format(addDays(new Date(), 7), "yyyy-MM-dd"),
    ordering: "due_date",
    page_size: 50,
  });

  const unpaid = (query.data?.results ?? []).filter((p) => p.remaining > 0);
  const items = unpaid.slice(0, LIMIT);

  const when = (due: string) => {
    const days = -fmt.daysFromToday(due);
    if (days <= 0) return t("dashboard.dueToday");
    if (days === 1) return t("dashboard.dueTomorrow");
    return t("dashboard.dueIn", { count: days, date: fmt.date(due) });
  };

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader>
        <CardTitle>{t("dashboard.upcomingList")}</CardTitle>
        {unpaid.length > LIMIT && (
          <Button asChild variant="link" size="sm" className="-mr-2 -mt-2 h-auto">
            <Link to="/payments?tab=pending">
              {t("common.showAll", { count: unpaid.length })}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        )}
      </CardHeader>

      <div className="mt-3">
        {query.isPending ? (
          <ListSkeleton rows={3} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />
        ) : items.length === 0 ? (
          <EmptyState illustration="coins" title={t("dashboard.noUpcoming")} description={t("dashboard.noUpcomingHint")} className="py-8" />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {items.map((p) => {
              const soon = fmt.daysFromToday(p.due_date) >= -1;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                  <Avatar name={p.tenant_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <Parties item={p} />
                    </p>
                    <p className={cn("mt-0.5 text-xs tabular", soon ? "font-medium text-warning" : "text-muted-foreground")}>
                      {when(p.due_date)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular">{fmt.money(p.remaining)}</span>
                  <Button size="sm" variant="secondary" onClick={() => setPaying(p)}>
                    {t("payments.markPaid")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <PayDialog payment={paying} onOpenChange={(o) => !o && setPaying(null)} />
    </Card>
  );
}
