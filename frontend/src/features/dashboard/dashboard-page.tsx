import { AlertCircle, Building2, CalendarClock, Clock, FileSignature, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { useDashboard, useMe } from "@/api/hooks";
import { todayISO, useFormat } from "@/lib/format";
import { CollectionCard } from "./collection-card";
import { ExpiringList } from "./expiring-list";
import { GettingStarted } from "./getting-started";
import { OverdueList } from "./overdue-list";
import { StatCard } from "./stat-card";
import { UpcomingList } from "./upcoming-list";

type DayPart = "morning" | "day" | "evening" | "night";

function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "day";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

function DashboardSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t("common.loading")} className="space-y-4">
      <Skeleton className="h-44 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = useDashboard();
  const me = useMe();
  const part = dayPart(new Date().getHours());
  const name = me.data?.first_name.trim();

  return (
    <>
      <PageHeader
        title={name ? t(`dashboard.greeting.${part}`, { name }) : t(`dashboard.greetingNoName.${part}`)}
        description={<span className="inline-block first-letter:uppercase">{fmt.month(todayISO())}</span>}
        actions={
          /* на телефоне те же действия — в кнопке «+» нижней навигации */
          <div className="hidden gap-2 lg:flex">
            <Button asChild variant="secondary">
              <Link to="/payments?tab=overdue">
                <Wallet aria-hidden />
                {t("quick.markPayment")}
              </Link>
            </Button>
            <Button asChild>
              <Link to="/leases/new">
                <FileSignature aria-hidden />
                {t("quick.newLease")}
              </Link>
            </Button>
          </div>
        }
      />

      {query.isPending ? (
        <DashboardSkeleton />
      ) : query.isError ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />
        </Card>
      ) : (
        <div className="space-y-4">
          <GettingStarted data={query.data} />

          {query.data.properties.total > 0 && <CollectionCard data={query.data} />}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={AlertCircle}
              tone={query.data.overdue.count > 0 ? "danger" : "neutral"}
              label={t("dashboard.overdue")}
              value={fmt.money(query.data.overdue.amount)}
              hint={t("dashboard.overdueCount", { count: query.data.overdue.count })}
              to="/payments?tab=overdue"
            />
            <StatCard
              icon={Clock}
              tone="info"
              label={t("dashboard.upcoming")}
              value={fmt.money(query.data.upcoming_7_days.amount)}
              hint={t("dashboard.overdueCount", { count: query.data.upcoming_7_days.count })}
              to="/payments?tab=pending"
            />
            <StatCard
              icon={Building2}
              tone="success"
              label={t("dashboard.vacant")}
              value={
                <>
                  {query.data.properties.vacant}
                  <span className="text-base font-normal text-muted-foreground"> / {query.data.properties.total}</span>
                </>
              }
              hint={
                query.data.properties.under_repair > 0
                  ? t("dashboard.underRepair", { count: query.data.properties.under_repair })
                  : t("dashboard.vacantHint")
              }
              to="/properties?state=vacant"
            />
            <StatCard
              icon={CalendarClock}
              tone={query.data.leases_expiring_30_days > 0 ? "warning" : "neutral"}
              label={t("dashboard.expiring")}
              value={query.data.leases_expiring_30_days}
              hint={t("dashboard.expiringHint")}
              to={query.data.leases_expiring_30_days > 0 ? "#expiring" : "/leases?status=active"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <OverdueList />
            <UpcomingList />
          </div>

          <ExpiringList />
        </div>
      )}
    </>
  );
}
