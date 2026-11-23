import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { leasesApi, paymentsApi } from "@/api/hooks";
import { todayISO, useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** Месячная сетка: платежи (по сроку) и окончания договоров. День открывает список. */
export function PaymentsCalendar({ propertyId, className }: { propertyId: number | null; className?: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<string>(todayISO());

  const from = iso(cursor);
  const to = iso(endOfMonth(cursor));
  const pays = paymentsApi.useList({ due_from: from, due_to: to, ordering: "due_date", page_size: 200 });
  const leases = leasesApi.useList({ status: "active", ordering: "end_date", page_size: 100 });

  const payments = (pays.data?.results ?? []).filter((p) => !propertyId || p.property === propertyId);
  const ending = (leases.data?.results ?? []).filter(
    (l) => l.end_date >= from && l.end_date <= to && (!propertyId || l.property === propertyId),
  );

  const today = todayISO();
  // понедельник — первый день недели
  const offset = (cursor.getDay() + 6) % 7;
  const days = endOfMonth(cursor).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: days }, (_, i) => iso(new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))),
  ];
  const weekdays = Array.from({ length: 7 }, (_, i) => fmt.weekdayShort(i));

  const dayPays = payments.filter((p) => p.due_date === selected);
  const dayEnding = ending.filter((l) => l.end_date === selected);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="first-letter:uppercase">{fmt.month(from)}</CardTitle>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" aria-label={t("dashboard.calendar.prev")} onClick={() => setCursor(addMonths(cursor, -1))}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button size="icon" variant="ghost" aria-label={t("dashboard.calendar.next")} onClick={() => setCursor(addMonths(cursor, 1))}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </CardHeader>
      <div className="px-3 pb-4 pt-3 sm:px-5">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
          {weekdays.map((w, i) => (
            <span key={i}>{w}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <span key={`e${i}`} />;
            const ps = payments.filter((p) => p.due_date === d);
            const hasOverdue = ps.some((p) => p.remaining > 0 && d < today);
            const hasDue = ps.some((p) => p.remaining > 0 && d >= today);
            const hasPaid = ps.length > 0 && ps.every((p) => p.remaining <= 0);
            const hasEnd = ending.some((l) => l.end_date === d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSelected(d)}
                aria-pressed={selected === d}
                className={cn(
                  "flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-sm tabular transition-colors hover:bg-muted",
                  selected === d && "bg-muted ring-1 ring-primary",
                  d === today && "font-semibold text-primary",
                )}
              >
                {Number(d.slice(8))}
                <span className="flex h-1.5 gap-0.5" aria-hidden>
                  {hasOverdue && <i className="size-1.5 rounded-full bg-danger" />}
                  {hasDue && <i className="size-1.5 rounded-full bg-info" />}
                  {hasPaid && <i className="size-1.5 rounded-full bg-success" />}
                  {hasEnd && <i className="size-1.5 rounded-full bg-warning" />}
                </span>
              </button>
            );
          })}
        </div>

        <ul className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
          {dayPays.length === 0 && dayEnding.length === 0 && (
            <li className="text-muted-foreground">{t("dashboard.calendar.empty", { date: fmt.date(selected) })}</li>
          )}
          {dayPays.map((p) => (
            <li key={`p${p.id}`} className="flex items-center gap-2">
              <i className={cn("size-2 shrink-0 rounded-full", p.remaining <= 0 ? "bg-success" : selected < today ? "bg-danger" : "bg-info")} aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {p.property_name} · {p.tenant_name}
              </span>
              <span className="tabular">{fmt.money(p.remaining > 0 ? p.remaining : p.amount_due)}</span>
            </li>
          ))}
          {dayEnding.map((l) => (
            <li key={`l${l.id}`} className="flex items-center gap-2">
              <i className="size-2 shrink-0 rounded-full bg-warning" aria-hidden />
              <Link to={`/leases/${l.id}`} className="min-w-0 flex-1 truncate hover:underline">
                {t("dashboard.calendar.leaseEnds", { name: l.property_name })}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
