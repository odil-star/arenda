import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dashboard } from "@/api/types";
import { useFormat } from "@/lib/format";
import { cn, toNumber } from "@/lib/utils";

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltip = {
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "var(--foreground)" },
  cursor: { fill: "var(--muted)", opacity: 0.4 },
};

/** Динамика: ожидалось и получено по месяцам, с переключателем 6 / 12 месяцев. */
export function IncomeChart({ data, range }: { data: Dashboard; range: 6 | 12 }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const rows = (data.months ?? []).slice(-range).map((m) => ({
    month: m.month,
    expected: toNumber(m.expected),
    received: toNumber(m.received),
  }));
  const has = rows.some((r) => r.expected + r.received > 0);

  return has ? (
    <figure aria-label={t("dashboard.insights.incomeChart")} className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={false} tickFormatter={(m: string) => fmt.monthShort(`${m}-01`)} />
          <YAxis tick={axis} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => fmt.compact(v)} />
          <Tooltip
            {...tooltip}
            labelFormatter={(m: string) => fmt.month(`${m}-01`)}
            formatter={(v: number, name: string) => [fmt.money(v), name === "expected" ? t("dashboard.expected") : t("dashboard.received")]}
          />
          <Legend formatter={(v: string) => (v === "expected" ? t("dashboard.expected") : t("dashboard.received"))} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="expected" fill="var(--track)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="received" fill="var(--primary)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  ) : (
    <p className="py-16 text-center text-sm text-muted-foreground">{t("dashboard.insights.noHistory")}</p>
  );
}

/** Стрелка «больше/меньше, чем в прошлом месяце». */
export function Delta({ now, prev, invert = false, className }: { now: number; prev: number; invert?: boolean; className?: string }) {
  const { t } = useTranslation();
  if (prev <= 0) return null;
  const pct = Math.round(((now - prev) / prev) * 100);
  const Icon = pct === 0 ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight;
  const good = pct === 0 ? null : invert ? pct < 0 : pct > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular",
        good === null ? "text-muted-foreground" : good ? "text-success" : "text-danger",
        className,
      )}
      title={t("dashboard.insights.vsPrev")}
    >
      <Icon className="size-3.5" aria-hidden />
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

/** Итоги за 12 месяцев: сколько получено, среднее в месяц, лучший месяц, доля собранного. */
export function SummaryCard({ data, className }: { data: Dashboard; className?: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const months = data.months ?? [];
  const received = months.reduce((s, m) => s + toNumber(m.received), 0);
  const expected = months.reduce((s, m) => s + toNumber(m.expected), 0);
  const active = months.filter((m) => toNumber(m.expected) > 0).length;
  const best = months.reduce<(typeof months)[number] | null>(
    (b, m) => (toNumber(m.received) > toNumber(b?.received ?? 0) ? m : b),
    null,
  );
  const percent = expected > 0 ? Math.min(100, Math.round((received / expected) * 100)) : 0;
  const rows: [string, string][] = [
    [t("dashboard.insights.summaryTotal"), fmt.money(received)],
    [t("dashboard.insights.summaryAvg"), fmt.money(active > 0 ? Math.round(received / active) : 0)],
    [t("dashboard.insights.summaryBest"), best && toNumber(best.received) > 0 ? fmt.month(`${best.month}-01`) : "—"],
  ];
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("dashboard.insights.summary")}</CardTitle>
      </CardHeader>
      <CardContent className="mt-3">
        <p className="font-display text-3xl font-semibold tabular">{percent}%</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--track)]" role="img" aria-label={t("dashboard.insights.summaryLabel", { percent })}>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("dashboard.insights.summaryHint")}</p>
        <dl className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium tabular first-letter:uppercase">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/** Какие объекты приносят больше всего (за 12 месяцев). */
export function PropertyIncomeCard({ data, className }: { data: Dashboard; className?: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const rows = data.properties_income ?? [];
  const max = Math.max(1, ...rows.map((r) => toNumber(r.received)));
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("dashboard.insights.byProperty")}</CardTitle>
      </CardHeader>
      <CardContent className="mt-3">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("dashboard.insights.noHistory")}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <Link to={`/properties/${r.id}`} className="min-w-0 truncate hover:underline">
                    {r.name}
                  </Link>
                  <span className="font-medium tabular">{fmt.money(r.received)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--track)]">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(toNumber(r.received) / max) * 100}%` }} />
                </div>
                {r.overdue_count > 0 && (
                  <p className="mt-0.5 text-xs text-danger">{t("dashboard.insights.overdueTimes", { count: r.overdue_count })}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Надёжность жильцов: «платит вовремя в N из M месяцев» (самые слабые сверху). */
export function ReliabilityCard({ data, className }: { data: Dashboard; className?: string }) {
  const { t } = useTranslation();
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("dashboard.insights.reliability")}</CardTitle>
      </CardHeader>
      <CardContent className="mt-3">
        {(data.reliability ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("dashboard.insights.noHistory")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {(data.reliability ?? []).map((r) => {
              const ratio = r.on_time / r.total;
              return (
                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className={cn("text-xs font-medium tabular", ratio >= 0.9 ? "text-success" : ratio >= 0.6 ? "text-warning" : "text-danger")}>
                    {t("dashboard.insights.onTime", { ok: r.on_time, total: r.total })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Тариф: сколько объектов использовано и когда продление. */
export function PlanCard({ data, className }: { data: Dashboard; className?: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const plan = data.plan;
  if (!plan) return null;
  const limit = plan.max_properties;
  const percent = limit ? Math.min(100, Math.round((plan.used / limit) * 100)) : 0;
  const full = limit !== null && plan.used >= limit;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("dashboard.insights.plan", { name: plan.name })}</CardTitle>
      </CardHeader>
      <CardContent className="mt-3">
        <p className="text-sm">
          {limit === null
            ? t("dashboard.insights.planUnlimited", { used: plan.used })
            : t("dashboard.insights.planUsed", { used: plan.used, limit })}
        </p>
        {limit !== null && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--track)]">
            <div className={cn("h-full rounded-full", full ? "bg-warning" : "bg-primary")} style={{ width: `${percent}%` }} />
          </div>
        )}
        {plan.paid_until && (
          <p className="mt-2 text-xs text-muted-foreground">{t("dashboard.insights.paidUntil", { date: fmt.date(plan.paid_until) })}</p>
        )}
        {full && (
          <Button asChild size="sm" variant="secondary" className="mt-3">
            <Link to="/support">{t("dashboard.insights.upgrade")}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
