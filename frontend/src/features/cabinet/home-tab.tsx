import { AlertCircle, CalendarClock, CheckCircle2, ChevronRight, Clock, Home, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TenantLease, TenantPayment } from "@/api/portal";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { firstPayable, groupPayments, sortLeases } from "./cabinet-logic";
import { EMPTY, Requisites, Section } from "./cabinet-ui";

export function HomeTab({ payments, leases }: { payments: TenantPayment[] | undefined; leases: TenantLease[] | undefined }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();

  if (!payments || !leases) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (!leases.length) return <p className={EMPTY}>{t("cabinet.empty")}</p>;

  const { due, upcoming, debt } = groupPayments(payments);
  const target = firstPayable(due);
  const next = upcoming[0];
  const late = target ? fmt.daysFromToday(target.due_date) : 0;
  const manyHouses = leases.filter((l) => l.status === "active").length > 1;
  const active = sortLeases(leases).filter((l) => l.status === "active");

  return (
    <>
      {target ? (
        <Card className={cn("space-y-4 rounded-2xl p-4 sm:p-5", late > 0 ? "border-danger/40" : "border-primary/30")}>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">{debt > 0 ? t("cabinet.due") : t("cabinet.pay.onReview")}</h2>
              {late > 0 && target.receipt_status !== "pending" && <Badge tone="danger" icon={AlertCircle}>{t("cabinet.overdue", { count: late })}</Badge>}
            </div>
            <p className="mt-1 text-3xl font-semibold tracking-tight whitespace-nowrap tabular-nums">{fmt.money(debt > 0 ? debt : target.remaining)}</p>
          </div>

          <p className="text-sm text-muted-foreground">
            {target.receipt_status === "pending"
              ? t("cabinet.reviewNote")
              : late > 0
                ? t("cabinet.dueNoteLate", { date: fmt.date(target.due_date), count: late })
                : t("cabinet.dueNote", { date: fmt.date(target.due_date) })}
            {due.length > 1 && <> {t("cabinet.dueCount", { count: due.length })}</>}
            {manyHouses && <> · {target.property_name}</>}
          </p>

          {target.receipt_status === "pending" && <Badge tone="info" icon={Clock}>{t("cabinet.pay.onReview")}</Badge>}
          {target.receipt_status === "rejected" && target.can_pay && (
            <div className="space-y-1">
              <Badge tone="danger" icon={XCircle}>{t("cabinet.pay.rejected")}</Badge>
              {target.receipt_reject_reason && <p className="text-sm text-danger">{t("cabinet.pay.reason", { reason: target.receipt_reject_reason })}</p>}
            </div>
          )}

          {target.can_pay && (
            <>
              <Requisites payment={target} />
              <Button size="lg" className="w-full" onClick={() => navigate(`/cabinet/pay/${target.id}`)}>
                {t("cabinet.pay.sendReceipt", { amount: fmt.money(target.remaining) })}
              </Button>
              <details className="group text-sm">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                  {t("cabinet.howTitle")}
                  <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <ol className="mt-2 space-y-2">
                  {[t("cabinet.how1"), t("cabinet.how2"), t("cabinet.how3")].map((text, i) => (
                    <li key={i} className="flex gap-3">
                      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
                      <span className="pt-0.5">{text}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}

          {due.length > 1 && (
            <Button variant="secondary" className="w-full" asChild>
              <Link to="/cabinet?tab=payments">{t("cabinet.allDue")}</Link>
            </Button>
          )}
        </Card>
      ) : (
        <Card className="flex items-center gap-3 rounded-2xl p-4 sm:p-5">
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle2 className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">{t("cabinet.allPaidTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("cabinet.nextNone")}</p>
          </div>
        </Card>
      )}

      {next && (
        <Section title={t("cabinet.upcoming")}>
          <Card className="flex items-center gap-3 p-3.5">
            <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
              <CalendarClock className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium first-letter:uppercase">{t("cabinet.forMonth", { month: fmt.month(next.due_date) })}</p>
              <p className="text-xs text-muted-foreground">
                {t("cabinet.payBefore", { date: fmt.date(next.due_date) })} · {t("cabinet.dueIn", { count: -fmt.daysFromToday(next.due_date) })}
              </p>
            </div>
            <p className="text-sm font-semibold tabular-nums">{fmt.money(next.remaining)}</p>
          </Card>
        </Section>
      )}

      {active.length > 0 && (
        <Section title={active.length > 1 ? t("cabinet.houses") : t("cabinet.myHome")}>
          <ul className="space-y-2">
            {active.map((l) => (
              <li key={l.id}>
                <Link
                  to={`/cabinet?tab=contract&lease=${l.id}`}
                  className="flex min-h-16 items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Home className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.property_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t("cabinet.rentLine", { amount: fmt.money(l.rent_amount), day: l.payment_day })}
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
