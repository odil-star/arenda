import { CheckCircle2, ChevronDown, Clock, Copy, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TenantLease, TenantPayment } from "@/api/portal";
import { PaymentDetails } from "@/features/cabinet/payment-details";
import { copyText } from "@/lib/clipboard";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

export const EMPTY = "rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground";

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Переключатель домов — показывается, только если домов больше одного. */
export function LeasePicker({ leases, current, onChange }: { leases: TenantLease[]; current: TenantLease | undefined; onChange: (id: number) => void }) {
  const { t } = useTranslation();
  if (leases.length < 2) return null;
  return (
    <div role="tablist" aria-label={t("cabinet.houses")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {leases.map((l) => {
        const active = l.id === current?.id;
        return (
          <button
            key={l.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(l.id)}
            className={cn(
              "h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              active ? "border-transparent bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
              l.status === "ended" && !active && "opacity-70",
            )}
          >
            {l.property_name}
          </button>
        );
      })}
    </div>
  );
}

/** Реквизиты с кнопкой «Скопировать». */
export function Requisites({ payment, className }: { payment: TenantPayment; className?: string }) {
  const { t } = useTranslation();
  const copy = async () => {
    if (await copyText(payment.payment_details)) toast.success(t("cabinet.copied"));
  };
  return (
    <div className={cn("rounded-lg bg-muted p-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{t("cabinet.requisites")}</p>
        {payment.payment_details && (
          <Button type="button" variant="ghost" size="sm" className="-my-1 -mr-2" onClick={() => void copy()}>
            <Copy aria-hidden /> {t("cabinet.copy")}
          </Button>
        )}
      </div>
      {payment.payment_details ? (
        <PaymentDetails text={payment.payment_details} className="mt-1 whitespace-pre-wrap break-words text-sm" />
      ) : (
        <p className="mt-1 text-sm">{t("cabinet.pay.noRequisites", { landlord: payment.landlord_name })}</p>
      )}
    </div>
  );
}

/** Одна строка платежа: месяц, сумма и то, что с ним можно сделать. */
export function PaymentRow({ p }: { p: TenantPayment }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const done = p.remaining <= 0 || p.status === "paid";
  const late = !done && p.receipt_status !== "pending" && fmt.daysFromToday(p.due_date) > 0;
  const rejected = p.receipt_status === "rejected" && p.can_pay;

  let sub: ReactNode;
  if (done) sub = p.paid_at ? t("cabinet.paidOn", { date: fmt.date(p.paid_at) }) : t("payments.status.paid");
  else if (p.amount_paid > 0) sub = t("cabinet.paidPart", { paid: fmt.money(p.amount_paid), total: fmt.money(p.amount_due) });
  else if (late) sub = <span className="text-danger">{t("cabinet.overdue", { count: fmt.daysFromToday(p.due_date) })}</span>;
  else sub = t("cabinet.payBefore", { date: fmt.date(p.due_date) });

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium first-letter:uppercase">{fmt.month(p.due_date)}</p>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className={cn("text-sm font-semibold whitespace-nowrap tabular-nums", done && "text-muted-foreground")}>{fmt.money(done ? p.amount_due : p.remaining)}</p>
          {done ? (
            <Badge tone="success" icon={CheckCircle2}>{t("payments.status.paid")}</Badge>
          ) : p.receipt_status === "pending" ? (
            <Badge tone="info" icon={Clock}>{t("cabinet.pay.onReview")}</Badge>
          ) : rejected ? (
            <Badge tone="danger" icon={XCircle}>{t("cabinet.pay.rejected")}</Badge>
          ) : null}
        </div>
      </div>
      {rejected && p.receipt_reject_reason && <p className="text-xs text-danger">{t("cabinet.pay.reason", { reason: p.receipt_reject_reason })}</p>}
      {p.can_pay && (
        <Button size="sm" className="w-full" onClick={() => navigate(`/cabinet/pay/${p.id}`)}>
          {t("cabinet.pay.action")} · {fmt.money(p.remaining)}
        </Button>
      )}
    </li>
  );
}

/** Список платежей в карточке; длинный список свёрнут до `limit` строк. */
export function PaymentList({ items, limit }: { items: TenantPayment[]; limit?: number }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const cut = limit !== undefined && !all && items.length > limit;
  const shown = cut ? items.slice(0, limit) : items;
  return (
    <div className="rounded-xl border border-border bg-card">
      <ul className="divide-y divide-border px-4">
        {shown.map((p) => (
          <PaymentRow key={p.id} p={p} />
        ))}
      </ul>
      {limit !== undefined && items.length > limit && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="flex min-h-11 w-full items-center justify-center gap-1 border-t border-border text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        >
          {all ? t("cabinet.showLess") : t("cabinet.showAll", { count: items.length })}
          <ChevronDown className={cn("size-4 transition-transform", all && "rotate-180")} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Раскрывающаяся строка настроек: заголовок + короткое значение, по нажатию — содержимое. */
export function Disclosure({ title, value, icon, children, defaultOpen }: { title: string; value?: ReactNode; icon?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        {icon && <span aria-hidden className="text-muted-foreground [&_svg]:size-5">{icon}</span>}
        <span className="flex-1 text-sm font-medium">{title}</span>
        {value && <span className="truncate text-sm text-muted-foreground">{value}</span>}
        <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}
