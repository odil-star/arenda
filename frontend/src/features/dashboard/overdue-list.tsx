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
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

const LIMIT = 5;

export function OverdueList({ className }: { className?: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = paymentsApi.useList({ status: "overdue", ordering: "due_date" });
  const [paying, setPaying] = useState<Payment | null>(null);

  const items = (query.data?.results ?? []).slice(0, LIMIT);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader>
        <CardTitle>{t("dashboard.overdueList")}</CardTitle>
        {query.data && query.data.count > LIMIT && (
          <Button asChild variant="link" size="sm" className="-mr-2 -mt-2 h-auto">
            <Link to="/payments?tab=overdue">
              {t("common.showAll", { count: query.data.count })}
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
          <EmptyState illustration="celebrate" title={t("dashboard.noOverdue")} description={t("dashboard.noOverdueHint")} className="py-8" />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {items.map((p) => {
              const days = fmt.daysFromToday(p.due_date);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                  <Avatar name={p.tenant_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <Parties item={p} />
                    </p>
                    <p className="mt-0.5 text-xs text-danger tabular">
                      {t("payments.overdueBy", { count: days, date: fmt.date(p.due_date) })}
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
