import { AlertCircle, Building2, CalendarClock, Clock, FileSignature, SlidersHorizontal, Wallet } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { propertiesApi, useDashboard, useMe } from "@/api/hooks";
import { todayISO, useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AttentionFeed } from "./attention-feed";
import { CollectionCard } from "./collection-card";
import { IncomeChart, SummaryCard, PlanCard, PropertyIncomeCard, ReliabilityCard } from "./insights";
import { PaymentsCalendar } from "./payments-calendar";
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

const SECTIONS = ["attention", "chart", "calendar", "summary", "properties", "reliability", "plan"] as const;
type Section = (typeof SECTIONS)[number];
const STORAGE_KEY = "dashboard.sections";
const ALL = "all";
/** одинаковая высота карточек в сетке */
const CARD = "h-full min-h-72";

function loadVisible(): Record<Section, boolean> {
  const all = Object.fromEntries(SECTIONS.map((s) => [s, true])) as Record<Section, boolean>;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Record<Section, boolean>>;
    return { ...all, ...saved };
  } catch {
    return all;
  }
}

export function DashboardPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = useDashboard();
  const properties = propertiesApi.useList({ page_size: 100 });
  const [propertyKey, setPropertyKey] = useState<string>(ALL);
  const propertyId = propertyKey === ALL ? null : Number(propertyKey);
  const [customizing, setCustomizing] = useState(false);
  const [visible, setVisible] = useState(loadVisible);
  const [range, setRange] = useState<6 | 12>(6);
  const toggle = (s: Section) =>
    setVisible((prev) => {
      const next = { ...prev, [s]: !prev[s] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* хранилище недоступно — настройка живёт до перезагрузки */
      }
      return next;
    });
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

          <div className="flex flex-wrap items-center gap-2">
            {(properties.data?.results.length ?? 0) > 1 && (
              <Select
                className="h-9 w-auto min-w-44 sm:h-9"
                aria-label={t("dashboard.filter.label")}
                value={propertyKey}
                onValueChange={setPropertyKey}
                options={[
                  { value: ALL, label: t("dashboard.filter.all") },
                  ...(properties.data?.results ?? []).map((p) => ({ value: String(p.id), label: p.name })),
                ]}
              />
            )}
            <Button size="sm" variant="ghost" className="ml-auto" aria-expanded={customizing} onClick={() => setCustomizing((v) => !v)}>
              <SlidersHorizontal aria-hidden />
              {t("dashboard.customize.button")}
            </Button>
          </div>
          {customizing && (
            <Card className="flex flex-wrap gap-2 p-3">
              {SECTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={visible[s]}
                  onClick={() => toggle(s)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    visible[s] ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
                  )}
                >
                  {t(`dashboard.customize.sections.${s}`)}
                </button>
              ))}
            </Card>
          )}

          {visible.attention && <AttentionFeed data={query.data} propertyId={propertyId} />}

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

          <div className="grid gap-4 lg:grid-cols-2">
            <OverdueList propertyId={propertyId} className="h-full" />
            <UpcomingList propertyId={propertyId} className="h-full" />
          </div>

          <ExpiringList propertyId={propertyId} />

          {visible.chart && (
            <Card>
              <CardHeader>
                <CardTitle>{t("dashboard.insights.incomeChart")}</CardTitle>
                <div className="flex gap-1" role="group" aria-label={t("dashboard.insights.range")}>
                  {([6, 12] as const).map((r) => (
                    <Button key={r} size="sm" variant={range === r ? "secondary" : "ghost"} aria-pressed={range === r} onClick={() => setRange(r)}>
                      {t("dashboard.insights.months", { count: r })}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="mt-3">
                <IncomeChart data={query.data} range={range} />
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:auto-rows-fr lg:grid-cols-2">
            {visible.calendar && <PaymentsCalendar propertyId={propertyId} className={CARD} />}
            {visible.summary && <SummaryCard data={query.data} className={CARD} />}
            {visible.properties && <PropertyIncomeCard data={query.data} className={CARD} />}
            {visible.reliability && <ReliabilityCard data={query.data} className={CARD} />}
            {visible.plan && <PlanCard data={query.data} className={CARD} />}
          </div>
        </div>
      )}
    </>
  );
}
