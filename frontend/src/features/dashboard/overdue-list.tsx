import type { TFunction } from "i18next";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/common/avatar";
import { Parties } from "@/components/common/entity-names";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { toast } from "sonner";
import { serverMessages } from "@/api/errors";
import { paymentsApi } from "@/api/hooks";
import { useRemindPayments, type RemindResult } from "@/api/portal";
import type { Payment } from "@/api/types";
import { PayDialog } from "@/features/payments/pay-dialog";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

const LIMIT = 5;

/** Итог рассылки напоминаний одним понятным сообщением. */
export function remindSummary(t: TFunction, r: RemindResult) {
  const parts = [
    r.sent && t("payments.remindSent", { count: r.sent }),
    r.already && t("payments.remindAlready", { count: r.already }),
    r.no_telegram && t("payments.remindNoTelegram", { count: r.no_telegram }),
    r.failed && t("payments.remindFailed", { count: r.failed }),
  ].filter(Boolean);
  return parts.join(" · ");
}

export function OverdueList({ className, propertyId = null }: { className?: string; propertyId?: number | null }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = paymentsApi.useList({ status: "overdue", ordering: "due_date" });
  const [paying, setPaying] = useState<Payment | null>(null);
  const remind = useRemindPayments();
  const onRemind = async (ids: number[]) => {
    try {
      const r = await remind.mutateAsync(ids);
      if (r.sent) toast.success(remindSummary(t, r));
      else toast.info(remindSummary(t, r));
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
    }
  };

  const items = (query.data?.results ?? []).filter((p) => !propertyId || p.property === propertyId).slice(0, LIMIT);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader>
        <CardTitle>{t("dashboard.overdueList")}</CardTitle>
        {items.length > 1 && (
          <Button size="sm" variant="secondary" loading={remind.isPending && (remind.variables?.length ?? 0) > 1}
            onClick={() => void onRemind(items.map((p) => p.id))}>
            {t("payments.remindAll")}
          </Button>
        )}
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
                  <Button size="sm" variant="ghost" loading={remind.isPending && remind.variables?.length === 1 && remind.variables[0] === p.id}
                    onClick={() => void onRemind([p.id])}>
                    {t("payments.remind")}
                  </Button>
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
