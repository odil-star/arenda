import { AlertCircle, CheckCircle2, CircleDashed, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { paymentsApi } from "@/api/hooks";
import type { PaymentStatus } from "@/api/types";
import { useUrlState } from "@/lib/hooks";
import { PaymentsList } from "./payments-list";

const TABS = [
  { value: "overdue", icon: AlertCircle },
  { value: "partial", icon: CircleDashed },
  { value: "pending", icon: Clock },
  { value: "paid", icon: CheckCircle2 },
] as const satisfies readonly { value: PaymentStatus; icon: typeof Clock }[];

function isTab(v: string): v is PaymentStatus {
  return TABS.some((tab) => tab.value === v);
}

/** Счётчик на вкладке: сколько платежей требуют внимания (просрочено / оплачено частично). */
function TabCount({ status }: { status: "overdue" | "partial" }) {
  const { data } = paymentsApi.useList({ status, page_size: 1 });
  if (!data?.count) return null;
  return (
    <span
      className={
        status === "overdue"
          ? "min-w-5 rounded-full bg-danger px-1.5 text-center text-xs font-semibold leading-5 text-white tabular dark:text-background"
          : "min-w-5 rounded-full bg-warning-soft px-1.5 text-center text-xs font-semibold leading-5 text-warning tabular"
      }
    >
      {data.count}
    </span>
  );
}

export function PaymentsPage() {
  const { t } = useTranslation();
  const { values, page, set } = useUrlState(["tab"] as const);
  const tab: PaymentStatus = isTab(values.tab) ? values.tab : "overdue";
  // оплаченные — свежие сверху, остальные — по сроку
  const query = paymentsApi.useList({ status: tab, page, ordering: tab === "paid" ? "-due_date" : "due_date" });

  return (
    <>
      <PageHeader title={t("payments.title")} description={t("payments.subtitle")} />

      <Tabs value={tab} onValueChange={(v) => set("tab", v === "overdue" ? null : v)}>
        <TabsList aria-label={t("payments.title")}>
          {TABS.map(({ value, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon aria-hidden />
              {t(`payments.tabs.${value}`)}
              {(value === "overdue" || value === "partial") && <TabCount status={value} />}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={tab} className="mt-4 outline-none">
          <PaymentsList
          query={query}
          caption={t(`payments.tabs.${tab}`)}
          page={page}
          onPageChange={(p) => set("page", p)}
          empty={
            tab === "overdue" ? (
              <EmptyState illustration="celebrate" title={t("dashboard.noOverdue")} description={t("dashboard.noOverdueHint")} />
            ) : (
              <EmptyState illustration="coins" title={t(`payments.empty.${tab}`)} description={t("payments.emptyHint")} />
            )
          }
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
