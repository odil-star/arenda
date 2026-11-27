import { CalendarPlus, LogOut, MessageCircle, Phone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/common/form-field";
import { serverMessages } from "@/api/errors";
import type { TenantLease, TenantPayment } from "@/api/portal";
import {
  useCancelLeaseRequest, useCreateLeaseRequest, useTenantLeaseRequests, type LeaseRequest, type LeaseRequestKind,
  type LeaseRequestStatus,
} from "@/api/requests";
import { todayISO, useFormat } from "@/lib/format";
import { Section } from "./cabinet-ui";

/** +998 90 123-45-67 → только цифры для ссылки t.me/+… */
const digits = (phone: string) => phone.replace(/\D/g, "");

/** Связь с арендодателем: позвонить и написать в Telegram. */
export function LandlordContact({ lease }: { lease: TenantLease }) {
  const { t } = useTranslation();
  const phone = (lease.landlord_phone ?? "").trim();
  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="text-xs text-muted-foreground">{t("cabinet.contact.title")}</p>
        <p className="text-base font-semibold">{lease.landlord_name}</p>
        {phone && <p className="text-sm tabular-nums text-muted-foreground">{phone}</p>}
      </div>
      {phone ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <a href={`tel:+${digits(phone)}`}>
              <Phone aria-hidden /> {t("cabinet.contact.call")}
            </a>
          </Button>
          {lease.landlord_telegram && (
            <Button asChild variant="secondary">
              <a href={`https://t.me/+${digits(phone)}`} target="_blank" rel="noreferrer">
                <MessageCircle aria-hidden /> {t("cabinet.contact.telegram")}
              </a>
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("cabinet.contact.noPhone")}</p>
      )}
    </Card>
  );
}

/** Правила дома и полезная информация, которую заполнил арендодатель. */
export function HouseRules({ lease }: { lease: TenantLease }) {
  const { t } = useTranslation();
  const text = (lease.house_rules ?? "").trim();
  if (!text) return null;
  return (
    <Section title={t("cabinet.rules")}>
      <p className="whitespace-pre-wrap break-words rounded-xl border border-border bg-card p-4 text-sm leading-relaxed">{text}</p>
    </Section>
  );
}

// ---------- продление и выезд ----------

const TONE: Record<LeaseRequestStatus, BadgeTone> = { pending: "info", accepted: "success", declined: "danger", cancelled: "neutral" };

function RequestSummary({ r }: { r: LeaseRequest }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  return (
    <p className="text-sm">
      {r.kind === "extend"
        ? t("cabinet.leaseReq.extendLine", { count: r.months ?? 0 })
        : t("cabinet.leaseReq.leaveLine", { date: fmt.date(r.move_out_date) })}
    </p>
  );
}

const MONTH_OPTIONS = [1, 3, 6, 12, 24].map((m) => ({ value: String(m), label: String(m) }));

function RequestDialog({
  lease, kind, onClose,
}: {
  lease: TenantLease;
  kind: LeaseRequestKind | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateLeaseRequest();
  const [months, setMonths] = useState("12");
  const [date, setDate] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | undefined>();

  const send = async () => {
    if (!kind) return;
    if (kind === "leave" && (!date || date < todayISO())) return setError(t("cabinet.leaseReq.dateInvalid"));
    try {
      await create.mutateAsync({
        lease: lease.id, kind, comment: comment.trim(),
        ...(kind === "extend" ? { months: Number(months) } : { move_out_date: date }),
      });
      toast.success(t("cabinet.leaseReq.sent"));
      onClose();
    } catch (e) {
      toast.error(serverMessages(e)[0] ?? t("errors.actionFailed"));
    }
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent
        title={kind === "leave" ? t("cabinet.leaseReq.leave") : t("cabinet.leaseReq.extend")}
        description={t("cabinet.leaseReq.hint")}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void send()} loading={create.isPending}>
              {t("services.send")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {kind === "extend" ? (
            <FormField label={t("cabinet.leaseReq.months")}>
              {(p) => <Select {...p} value={months} onValueChange={setMonths} options={MONTH_OPTIONS} />}
            </FormField>
          ) : (
            <FormField label={t("cabinet.leaseReq.date")} error={error}>
              {(p) => <Input {...p} type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />}
            </FormField>
          )}
          <FormField label={t("cabinet.leaseReq.comment")} optional>
            {(p) => <Textarea {...p} rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Кнопки «Продлить» и «Сообщить о выезде»; пока просьба ждёт ответа — её статус и отмена. */
export function LeaseRequestSection({ lease }: { lease: TenantLease }) {
  const { t } = useTranslation();
  const requests = useTenantLeaseRequests();
  const cancel = useCancelLeaseRequest();
  const [kind, setKind] = useState<LeaseRequestKind | null>(null);
  if (lease.status !== "active") return null;

  const mine = (requests.data ?? []).filter((r) => r.lease === lease.id);
  const pending = mine.find((r) => r.status === "pending");
  const last = mine.find((r) => r.status === "accepted" || r.status === "declined");

  const onCancel = async (id: number) => {
    try {
      await cancel.mutateAsync(id);
      toast.success(t("cabinet.leaseReq.cancelled"));
    } catch (e) {
      toast.error(serverMessages(e)[0] ?? t("errors.actionFailed"));
    }
  };

  return (
    <Section title={t("cabinet.leaseReq.title")}>
      {pending ? (
        <Card className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <RequestSummary r={pending} />
            <Badge tone={TONE.pending}>{t("cabinet.leaseReq.status.pending")}</Badge>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void onCancel(pending.id)} loading={cancel.isPending}>
            {t("cabinet.leaseReq.cancel")}
          </Button>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => setKind("extend")}>
            <CalendarPlus aria-hidden /> {t("cabinet.leaseReq.extend")}
          </Button>
          <Button variant="secondary" onClick={() => setKind("leave")}>
            <LogOut aria-hidden /> {t("cabinet.leaseReq.leave")}
          </Button>
        </div>
      )}
      {!pending && last && (
        <Card className="mt-2 space-y-1.5 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <RequestSummary r={last} />
            <Badge tone={TONE[last.status]}>{t(`cabinet.leaseReq.status.${last.status}`)}</Badge>
          </div>
          {last.landlord_comment && <p className="text-sm text-muted-foreground">{last.landlord_comment}</p>}
        </Card>
      )}
      <RequestDialog key={kind ?? "none"} lease={lease} kind={kind} onClose={() => setKind(null)} />
    </Section>
  );
}

// ---------- итоги года ----------

/** Сколько заплачено за год, сколько платежей вовремя и залог. Всё считается из уже загруженных платежей. */
export function YearSummary({ payments, leases }: { payments: TenantPayment[]; leases: TenantLease[] }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const year = todayISO().slice(0, 4);
  const ofYear = payments.filter((p) => p.due_date.startsWith(year));
  const paid = ofYear.reduce((s, p) => s + p.amount_paid, 0);
  const closed = ofYear.filter((p) => p.status === "paid");
  const onTime = closed.filter((p) => p.paid_at && p.paid_at.slice(0, 10) <= p.due_date).length;
  const deposit = leases.filter((l) => l.status === "active").reduce((s, l) => s + l.deposit_amount, 0);
  if (ofYear.length === 0) return null;

  const tiles: { label: string; value: string }[] = [
    { label: t("cabinet.summary.paid", { year }), value: fmt.money(paid) },
    { label: t("cabinet.summary.onTime"), value: closed.length ? `${onTime} / ${closed.length}` : "—" },
    ...(deposit > 0 ? [{ label: t("cabinet.summary.deposit"), value: fmt.money(deposit) }] : []),
  ];
  return (
    <Section title={t("cabinet.summary.title")}>
      <dl className="grid grid-cols-2 gap-2">
        {tiles.map((x, i) => (
          <Card key={x.label} className={`p-3.5 ${i === 0 && tiles.length % 2 === 1 ? "col-span-2" : ""}`}>
            <dt className="text-xs text-muted-foreground">{x.label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{x.value}</dd>
          </Card>
        ))}
      </dl>
    </Section>
  );
}
