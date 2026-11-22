import { useSearchParams } from "react-router-dom";
import type { TenantLease, TenantPayment } from "@/api/portal";
import { todayISO } from "@/lib/format";

/** Месяц платежа уже наступил (оплатить можно только с начала месяца). */
export const monthReached = (due: string) => due.slice(0, 7) <= todayISO().slice(0, 7);

const isOpen = (p: TenantPayment) => p.remaining > 0 && p.status !== "paid";

export interface PaymentGroups {
  /** Наступившие и неоплаченные — по возрастанию даты (сначала самые старые долги) */
  due: TenantPayment[];
  /** Будущие месяцы — по возрастанию даты */
  upcoming: TenantPayment[];
  /** Оплаченные — сначала новые */
  paid: TenantPayment[];
  /** Сумма к оплате сейчас (без платежей, чек по которым на проверке) */
  debt: number;
}

/** Делит платежи (отсортированы по due_date) на «оплатить», «предстоящие» и «оплаченные». */
export function groupPayments(items: TenantPayment[]): PaymentGroups {
  const due: TenantPayment[] = [];
  const upcoming: TenantPayment[] = [];
  const paid: TenantPayment[] = [];
  for (const p of items) {
    if (!isOpen(p)) paid.push(p);
    else if (monthReached(p.due_date) || p.status === "overdue" || p.status === "partial") due.push(p);
    else upcoming.push(p);
  }
  paid.reverse();
  // чек на проверке — жилец уже заплатил, в «нужно оплатить» не считаем
  const debt = due.filter((p) => p.receipt_status !== "pending").reduce((s, p) => s + p.remaining, 0);
  return { due, upcoming, paid, debt };
}

/** Какой платёж предложить оплатить первым: самый старый, который можно оплатить. */
export const firstPayable = (due: TenantPayment[]) => due.find((p) => p.can_pay) ?? due[0];

/** Сначала действующие договоры, потом завершённые. */
export function sortLeases(leases: TenantLease[]): TenantLease[] {
  return [...leases].sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1));
}

/** Выбранный дом хранится в адресе (?lease=ID), по умолчанию — первый действующий. */
export function useLeaseChoice(leases: TenantLease[] | undefined) {
  const [params, setParams] = useSearchParams();
  const sorted = sortLeases(leases ?? []);
  const raw = params.get("lease");
  const current = sorted.find((l) => String(l.id) === raw) ?? sorted[0];
  const choose = (id: number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("lease", String(id));
        return next;
      },
      { replace: true },
    );
  return { leases: sorted, current, choose };
}
