import { CheckCircle2, Clock, Gauge, Plus, Wrench, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField } from "@/components/common/form-field";
import { serverMessages } from "@/api/errors";
import type { TenantLease } from "@/api/portal";
import {
  METER_KINDS, useCreateRepair, useSubmitMeter, useTenantMeters, useTenantRepairs,
  type MeterEntry, type MeterKind, type Repair, type RepairStatus,
} from "@/api/requests";
import { todayISO, useFormat } from "@/lib/format";
import { useLeaseChoice } from "./cabinet-logic";
import { EMPTY, LeasePicker, Section } from "./cabinet-ui";
import { PhotoPicker, RequestPhoto } from "./request-parts";

const STATUS: Record<RepairStatus, { tone: BadgeTone; icon: typeof Clock }> = {
  new: { tone: "info", icon: Clock },
  in_progress: { tone: "warning", icon: Wrench },
  done: { tone: "success", icon: CheckCircle2 },
  rejected: { tone: "danger", icon: XCircle },
};

export function RepairStatusBadge({ status }: { status: RepairStatus }) {
  const { t } = useTranslation();
  const { tone, icon } = STATUS[status];
  return (
    <Badge tone={tone} icon={icon}>
      {t(`services.repairStatus.${status}`)}
    </Badge>
  );
}

function RepairDialog({ lease, open, onOpenChange }: { lease: TenantLease; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const create = useCreateRepair();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>();

  const submit = async () => {
    if (!title.trim()) return setError(t("validation.required"));
    try {
      await create.mutateAsync({ lease: lease.id, title: title.trim(), description: description.trim(), photo });
      toast.success(t("services.repairSent"));
      setTitle("");
      setDescription("");
      setPhoto(null);
      setError(undefined);
      onOpenChange(false);
    } catch (e) {
      toast.error(serverMessages(e)[0] ?? t("errors.actionFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent
        title={t("services.repairNew")}
        description={lease.property_name}
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submit()} loading={create.isPending}>
              {t("services.send")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label={t("services.repairTitle")} error={error}>
            {(p) => <Input {...p} value={title} maxLength={120} placeholder={t("services.repairTitlePlaceholder")} onChange={(e) => setTitle(e.target.value)} />}
          </FormField>
          <FormField label={t("services.repairDescription")} optional>
            {(p) => <Textarea {...p} value={description} maxLength={2000} rows={4} onChange={(e) => setDescription(e.target.value)} />}
          </FormField>
          <PhotoPicker file={photo} onChange={setPhoto} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RepairItem({ r }: { r: Repair }) {
  const fmt = useFormat();
  return (
    <Card className="space-y-2 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-medium">{r.title}</p>
        <RepairStatusBadge status={r.status} />
      </div>
      {r.description && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{r.description}</p>}
      {r.has_photo && <RequestPhoto path={`/tenant/repairs/${r.id}/photo/`} alt={r.title} />}
      {r.landlord_comment && <p className="rounded-lg bg-muted p-2.5 text-sm">{r.landlord_comment}</p>}
      <p className="text-xs text-muted-foreground">{fmt.date(r.created_at.slice(0, 10))}</p>
    </Card>
  );
}

function RepairsSection({ lease }: { lease: TenantLease }) {
  const { t } = useTranslation();
  const repairs = useTenantRepairs();
  const [open, setOpen] = useState(false);
  const items = (repairs.data ?? []).filter((r) => r.lease === lease.id);
  const active = lease.status === "active";
  return (
    <Section
      title={t("services.repairs")}
      action={
        active && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-tour="repair-new">
            <Plus aria-hidden /> {t("services.repairNew")}
          </Button>
        )
      }
    >
      {repairs.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : items.length === 0 ? (
        <p className={EMPTY}>{t("services.repairsEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.id}>
              <RepairItem r={r} />
            </li>
          ))}
        </ul>
      )}
      <RepairDialog lease={lease} open={open} onOpenChange={setOpen} />
    </Section>
  );
}

// ---------- счётчики ----------

function MeterDialog({
  lease, kind, onClose,
}: {
  lease: TenantLease;
  kind: MeterKind | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const submit = useSubmitMeter();
  const [value, setValue] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>();

  const send = async () => {
    if (!kind) return;
    if (!/^\d{1,10}$/.test(value.trim())) return setError(t("services.meterInvalid"));
    try {
      await submit.mutateAsync({ lease: lease.id, kind, value: Number(value), photo });
      toast.success(t("services.meterSent"));
      setValue("");
      setPhoto(null);
      setError(undefined);
      onClose();
    } catch (e) {
      const messages = serverMessages(e);
      setError(messages[0]);
      if (!messages.length) toast.error(t("errors.actionFailed"));
    }
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && !submit.isPending && onClose()}>
      <DialogContent
        title={kind ? t(`services.meter.${kind}`) : ""}
        description={lease.property_name}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={submit.isPending}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void send()} loading={submit.isPending}>
              {t("services.send")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label={t("services.meterValue")} error={error} hint={t("services.meterHint")}>
            {(p) => <Input {...p} value={value} inputMode="numeric" className="tabular" onChange={(e) => setValue(e.target.value)} />}
          </FormField>
          <PhotoPicker file={photo} onChange={setPhoto} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Расход по месяцам: разность соседних показаний, от старых к новым. */
function consumption(entries: MeterEntry[]) {
  const sorted = [...entries].sort((a, b) => a.period.localeCompare(b.period));
  return sorted.slice(1).map((e, i) => ({ period: e.period, delta: e.value - sorted[i].value }));
}

function MeterRow({ kind, entries, canSend, onSend }: { kind: MeterKind; entries: MeterEntry[]; canSend: boolean; onSend: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const latest = [...entries].sort((a, b) => b.period.localeCompare(a.period))[0];
  const history = consumption(entries).slice(-6);
  const max = Math.max(1, ...history.map((h) => h.delta));
  const thisMonth = latest?.period.slice(0, 7) === todayISO().slice(0, 7);

  return (
    <li className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Gauge className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t(`services.meter.${kind}`)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {latest ? `${fmt.number(latest.value)} · ${fmt.month(latest.period)}` : t("services.meterNone")}
          </p>
        </div>
        {canSend && (
          <Button size="sm" variant={thisMonth ? "ghost" : "secondary"} onClick={onSend}>
            {thisMonth ? t("services.meterChange") : t("services.meterSend")}
          </Button>
        )}
      </div>
      {history.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">{t("services.meterUsage")}</p>
          <ul className="flex h-14 items-end gap-1.5" aria-label={t("services.meterUsage")}>
            {history.map((h) => (
              <li key={h.period} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${fmt.month(h.period)}: ${h.delta}`}>
                <span className="text-[10px] leading-none tabular-nums text-muted-foreground">{fmt.number(h.delta)}</span>
                <span className="w-full rounded-sm bg-primary/70" style={{ height: `${Math.max(4, (h.delta / max) * 28)}px` }} />
                <span className="text-[10px] leading-none text-muted-foreground">{fmt.monthShort(h.period)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function MetersSection({ lease }: { lease: TenantLease }) {
  const { t } = useTranslation();
  const meters = useTenantMeters();
  const [kind, setKind] = useState<MeterKind | null>(null);
  const mine = (meters.data ?? []).filter((m) => m.lease === lease.id);
  return (
    <Section title={t("services.meters")}>
      {meters.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {METER_KINDS.map((k) => (
            <MeterRow key={k} kind={k} entries={mine.filter((m) => m.kind === k)} canSend={lease.status === "active"} onSend={() => setKind(k)} />
          ))}
        </ul>
      )}
      <MeterDialog key={kind ?? "none"} lease={lease} kind={kind} onClose={() => setKind(null)} />
    </Section>
  );
}

export function ServicesTab({ leases }: { leases: TenantLease[] | undefined }) {
  const { t } = useTranslation();
  const choice = useLeaseChoice(leases);
  if (!leases) return <Skeleton className="h-60 w-full" />;
  if (!choice.current) return <p className={EMPTY}>{t("cabinet.empty")}</p>;
  return (
    <>
      <LeasePicker leases={choice.leases} current={choice.current} onChange={choice.choose} />
      <RepairsSection key={`r${choice.current.id}`} lease={choice.current} />
      <MetersSection key={`m${choice.current.id}`} lease={choice.current} />
    </>
  );
}
