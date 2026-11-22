import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/states";
import { useAdminDaily } from "@/api/admin";
import { useFormat } from "@/lib/format";

const day = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Два графика за 30 дней: оплаты (онлайн и вручную) и новые арендодатели. */
export function AdminDailyCharts() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = useAdminDaily(30);

  if (query.isPending) return <Skeleton className="mt-3 h-64" />;
  if (query.isError) {
    return (
      <div className="mt-3">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </div>
    );
  }

  const data = query.data.map((p) => {
    const total = Number(p.payments_sum);
    const online = Number(p.online_sum);
    return { date: p.date, online, manual: Math.max(0, total - online), landlords: p.new_landlords };
  });
  const hasPayments = data.some((d) => d.online + d.manual > 0);
  const hasLandlords = data.some((d) => d.landlords > 0);
  const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
  const tooltip = {
    contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 },
    labelStyle: { color: "var(--foreground)" },
    cursor: { fill: "var(--muted)", opacity: 0.4 },
  };

  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div>
            <CardTitle>{t("admin.chart.payments")}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("admin.chart.title")}</p>
          </div>
        </CardHeader>
        <CardContent>
          {hasPayments ? (
            <figure aria-label={t("admin.chart.payments")} className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={day} tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => fmt.compact(v)} />
                  <Tooltip
                    {...tooltip}
                    labelFormatter={(l: string) => fmt.date(l)}
                    formatter={(v: number, name: string) => [fmt.money(v), name === "online" ? t("admin.chart.online") : t("admin.chart.total")]}
                  />
                  <Bar dataKey="online" stackId="p" fill="var(--primary)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="manual" stackId="p" fill="var(--info)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </figure>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">{t("admin.chart.empty")}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("admin.chart.newLandlords")}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("admin.chart.title")}</p>
          </div>
        </CardHeader>
        <CardContent>
          {hasLandlords ? (
            <figure aria-label={t("admin.chart.newLandlords")} className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={day} tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                  <Tooltip {...tooltip} labelFormatter={(l: string) => fmt.date(l)} formatter={(v: number) => [v, t("admin.chart.newLandlords")]} />
                  <Bar dataKey="landlords" fill="var(--success)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </figure>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">{t("admin.chart.empty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
