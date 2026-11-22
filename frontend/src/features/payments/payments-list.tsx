import type { UseQueryResult } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DataList, type Column } from "@/components/common/data-list";
import { Parties } from "@/components/common/entity-names";
import { PaymentStatusBadge } from "@/components/common/status-badges";
import type { Paginated, Payment } from "@/api/types";
import { useFormat } from "@/lib/format";
import { PayDialog } from "./pay-dialog";

interface PaymentsListProps {
  query: UseQueryResult<Paginated<Payment>>;
  page: number;
  onPageChange: (page: number) => void;
  empty: ReactNode;
  /** На странице договора объект и арендатор и так понятны */
  showLease?: boolean;
  caption: string;
}

export function PaymentsList({ query, page, onPageChange, empty, showLease = true, caption }: PaymentsListProps) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [paying, setPaying] = useState<Payment | null>(null);

  const columns: Column<Payment>[] = [
    ...(showLease
      ? [{ key: "lease", header: t("payments.lease"), cell: (p: Payment) => <Parties item={p} /> }]
      : []),
    { key: "due", header: t("payments.dueDate"), cell: (p) => <span className="tabular">{fmt.date(p.due_date)}</span> },
    { key: "amount", header: t("payments.amountDue"), align: "right", cell: (p) => fmt.money(p.amount_due) },
    { key: "paid", header: t("payments.paid"), align: "right", cell: (p) => fmt.money(p.amount_paid) },
    {
      key: "remaining",
      header: t("payments.balance"),
      align: "right",
      cell: (p) => <span className="font-medium">{fmt.money(p.remaining)}</span>,
    },
    { key: "status", header: t("common.status"), cell: (p) => <PaymentStatusBadge status={p.status} /> },
  ];

  const canPay = (p: Payment) => p.status !== "paid" && p.remaining > 0;

  return (
    <>
      <DataList
        query={query}
        caption={caption}
        columns={columns}
        page={page}
        onPageChange={onPageChange}
        empty={empty}
        renderMobile={(p) => (
          <div className="space-y-1.5">
            {showLease && (
              <p className="truncate text-sm">
                <Parties item={p} />
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground tabular">{fmt.date(p.due_date)}</span>
              <PaymentStatusBadge status={p.status} />
            </div>
            <p className="text-sm tabular">
              <span className="font-semibold">{fmt.money(p.remaining)}</span>
              {p.amount_paid > 0 && (
                <span className="text-muted-foreground"> · {t("payments.ofAmount", { amount: fmt.money(p.amount_due) })}</span>
              )}
            </p>
          </div>
        )}
        actions={(p) =>
          canPay(p) ? (
            <Button size="sm" variant="secondary" onClick={() => setPaying(p)}>
              {t("payments.markPaid")}
            </Button>
          ) : null
        }
      />
      <PayDialog payment={paying} onOpenChange={(o) => !o && setPaying(null)} />
    </>
  );
}
