import { AlertCircle, Check, CircleDashed, Clock, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { paymentsApi } from "@/api/hooks";
import type { PaymentStatus } from "@/api/types";
import { todayISO, useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

const VISUAL: Record<PaymentStatus, { icon: LucideIcon; className: string }> = {
  paid: { icon: Check, className: "bg-success text-white dark:text-background border-success" },
  partial: { icon: CircleDashed, className: "bg-warning-soft text-warning border-warning/40" },
  overdue: { icon: AlertCircle, className: "bg-danger-soft text-danger border-danger/40" },
  pending: { icon: Clock, className: "bg-card text-muted-foreground border-border" },
};

/**
 * Лента платежей договора: кружок на каждый месяц, цвет + иконка по статусу.
 * Даёт понять состояние договора одним взглядом.
 */
export function PaymentStrip({ leaseId }: { leaseId: number }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = paymentsApi.useList({ lease: leaseId, page_size: 60, ordering: "due_date" });
  const currentMonth = todayISO().slice(0, 7);

  if (query.isPending) {
    return (
      <div className="flex gap-3" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="size-9 rounded-full" />
        ))}
      </div>
    );
  }
  if (query.isError || !query.data.results.length) return null;

  const payments = query.data.results;
  const paidCount = payments.filter((p) => p.status === "paid").length;

  return (
    // сетка minmax(0,1fr): лента прокручивается внутри и не распирает страницу на телефоне
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{t("leases.strip.title")}</p>
        <p className="text-xs text-muted-foreground tabular">
          {t("leases.strip.progress", { paid: paidCount, total: payments.length })}
        </p>
      </div>
      <ol className="-mx-1 flex gap-1.5 overflow-x-auto overflow-y-hidden px-1.5 pb-1.5 pt-1.5 [scrollbar-width:thin]" aria-label={t("leases.strip.title")}>
        {payments.map((p, i) => {
          const { icon: Icon, className } = VISUAL[p.status];
          const isCurrent = p.due_date.slice(0, 7) === currentMonth;
          const showYear = i === 0 || p.due_date.slice(5, 7) === "01";
          return (
            <li
              key={p.id}
              className="flex w-10 shrink-0 flex-col items-center gap-1 animate-rise-in"
              style={{ animationDelay: `${Math.min(i, 12) * 30}ms`, animationFillMode: "both" }}
              title={`${fmt.date(p.due_date)} · ${t(`payments.status.${p.status}`)}`}
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full border",
                  className,
                  isCurrent && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <span className={cn("text-[11px] text-muted-foreground", isCurrent && "font-semibold text-foreground")}>
                {fmt.monthShort(p.due_date)}
              </span>
              <span className={cn("h-3 text-[10px] leading-3 text-muted-foreground tabular", !showYear && "invisible")}>
                {p.due_date.slice(2, 4)}
              </span>
              <span className="sr-only">
                {fmt.date(p.due_date)}: {t(`payments.status.${p.status}`)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
