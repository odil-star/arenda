import { Banknote, Building2, FileText, Lock, TriangleAlert, Users, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/features/dashboard/stat-card";
import { useAdminStats } from "@/api/admin";
import { AdminDailyCharts } from "./daily-chart";
import { useFormat } from "@/lib/format";

export function AdminOverviewTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = useAdminStats();

  if (query.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;

  const s = query.data;
  return (
    <>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <StatCard icon={Users} label={t("admin.stats.landlords")} value={fmt.number(s.landlords)}
        hint={t("admin.stats.landlordsHint", { count: s.landlords_new_30d })} />
      <StatCard icon={Lock} tone={s.landlords_blocked ? "warning" : "neutral"} label={t("admin.stats.blocked")}
        value={fmt.number(s.landlords_blocked)} to="/admin/landlords?filter=blocked" />
      <StatCard icon={Users} label={t("admin.stats.tenants")} value={fmt.number(s.tenants)} />
      <StatCard icon={Building2} label={t("admin.stats.properties")} value={fmt.number(s.properties)} />
      <StatCard icon={FileText} label={t("admin.stats.activeLeases")} value={fmt.number(s.active_leases)} />
      <StatCard icon={Wallet} tone="success" label={t("admin.stats.monthPayments")} value={fmt.money(s.month_payments_sum)}
        hint={fmt.number(s.month_payments_count)} />
      <StatCard icon={Banknote} tone="info" label={t("admin.stats.monthOnline")} value={fmt.money(s.month_online_sum)}
        hint={fmt.number(s.month_online_count)} to="/admin/payments" />
      <StatCard icon={TriangleAlert} tone={s.overdue_count ? "danger" : "neutral"} label={t("admin.stats.overdue")}
        value={fmt.money(s.overdue_sum)} hint={t("admin.stats.overdueHint", { count: s.overdue_count })} />
      <StatCard icon={TriangleAlert} tone={s.problem_payments ? "warning" : "neutral"} label={t("admin.stats.problem")}
        value={fmt.number(s.problem_payments)} hint={t("admin.stats.problemHint")} to="/admin/payments?problem=1" />
    </div>
    <AdminDailyCharts />
    </>
  );
}
