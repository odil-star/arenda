import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import type { TenantLease, TenantPayment } from "@/api/portal";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { groupPayments, useLeaseChoice } from "./cabinet-logic";
import { EMPTY, LeasePicker, PaymentList, Section } from "./cabinet-ui";

/** Платежи одного дома: долг, «оплатить», ближайшие и история. */
export function LeasePayments({ payments }: { payments: TenantPayment[] }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { due, upcoming, paid, debt } = groupPayments(payments);
  const late = due.some((p) => p.receipt_status !== "pending" && fmt.daysFromToday(p.due_date) > 0);

  if (!payments.length) return <p className={EMPTY}>{t("cabinet.noPayments")}</p>;

  return (
    <>
      {debt > 0 ? (
        <div className={cn("flex items-center gap-3 rounded-xl p-4", late ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
          <AlertCircle className="size-5 shrink-0" aria-hidden />
          <p className="flex-1 text-sm font-medium">{t("cabinet.due")}</p>
          <p className="text-lg font-semibold tabular-nums">{fmt.money(debt)}</p>
        </div>
      ) : due.length > 0 ? (
        <div className="flex items-center gap-3 rounded-xl bg-info-soft p-4 text-info">
          <Clock className="size-5 shrink-0" aria-hidden />
          <p className="text-sm font-medium">{t("cabinet.reviewNote")}</p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl bg-success-soft p-4 text-success">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          <p className="text-sm font-medium">{t("cabinet.nextNone")}</p>
        </div>
      )}

      {due.length > 0 && (
        <Section title={t("cabinet.sectionDue")}>
          <PaymentList items={due} />
        </Section>
      )}
      {upcoming.length > 0 && (
        <Section title={t("cabinet.sectionUpcoming")}>
          <PaymentList items={upcoming} limit={2} />
        </Section>
      )}
      {paid.length > 0 && (
        <Section title={t("cabinet.sectionPaid")}>
          <PaymentList items={paid} limit={3} />
        </Section>
      )}
    </>
  );
}

export function PaymentsTab({ all, leases }: { all: TenantPayment[] | undefined; leases: TenantLease[] | undefined }) {
  const { t } = useTranslation();
  const choice = useLeaseChoice(leases);

  if (!all || !leases) return <Skeleton className="h-60 w-full" />;
  if (!choice.current) return <p className={EMPTY}>{t("cabinet.empty")}</p>;

  const items = all.filter((p) => p.lease === choice.current?.id);
  return (
    <>
      <LeasePicker leases={choice.leases} current={choice.current} onChange={choice.choose} />
      <LeasePayments key={choice.current.id} payments={items} />
    </>
  );
}
