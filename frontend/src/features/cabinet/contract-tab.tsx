import { ChevronRight, Images, Trash2, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { LeaseStatusBadge } from "@/components/common/status-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { errorKind } from "@/api/errors";
import { useHideTenantLease, useTenantMedia, type TenantLease } from "@/api/portal";
import { parseInventory } from "@/features/leases/inventory-editor";
import { useFormat } from "@/lib/format";
import { useLeaseChoice } from "./cabinet-logic";
import { EMPTY, LeasePicker, Section } from "./cabinet-ui";
import { HouseRules, LandlordContact, LeaseRequestSection } from "./lease-extras";

function LinkRow({ to, icon, label, count }: { to: string; icon: ReactNode; label: string; count?: number }) {
  return (
    <Link to={to} className="flex min-h-14 items-center gap-3 px-4 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
      <span aria-hidden className="text-muted-foreground [&_svg]:size-5">{icon}</span>
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="tabular-nums text-muted-foreground">{count}</span>}
      <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** Завершённый договор можно убрать из кабинета, чтобы не мешал. */
function HideLease({ lease }: { lease: TenantLease }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hide = useHideTenantLease();
  const confirm = () =>
    hide.mutate(lease.id, {
      onSuccess: () => {
        setOpen(false);
        toast.success(t("cabinet.hideDone"));
      },
      onError: (error) => toast.error(t(`errors.${errorKind(error)}.description`)),
    });
  return (
    <>
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden /> {t("cabinet.hide")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("cabinet.hideTitle")}
        description={t("cabinet.hideHint")}
        confirmLabel={t("cabinet.hide")}
        loading={hide.isPending}
        onConfirm={confirm}
      />
    </>
  );
}

/** Договор: аренда и срок, условия, опись (если есть), ссылки на фото и платежи. */
export function LeaseTerms({ lease: l }: { lease: TenantLease }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const spent = fmt.daysFromToday(l.start_date);
  const total = Math.max(1, spent - fmt.daysFromToday(l.end_date));
  const left = Math.max(0, -fmt.daysFromToday(l.end_date));
  const items = parseInventory(l.inventory);
  const media = useTenantMedia(l.id);
  const mediaCount = media.data?.length ?? 0;
  const terms: [string, string][] = [
    [t("cabinet.termPayDay"), t("cabinet.termPayDayValue", { day: l.payment_day })],
    ...(l.deposit_amount > 0 ? ([[t("cabinet.termDeposit"), fmt.money(l.deposit_amount)]] as [string, string][]) : []),
    [t("cabinet.termLandlord"), l.landlord_name],
  ];

  return (
    <>
      <Card className="space-y-4 rounded-2xl p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{l.property_name}</p>
            {l.property_address && <p className="truncate text-sm text-muted-foreground">{l.property_address}</p>}
          </div>
          {l.status === "ended" && <LeaseStatusBadge status={l.status} />}
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{t("cabinet.termRent")}</p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{fmt.money(l.rent_amount)}</p>
        </div>
        <div className="space-y-1.5">
          <Progress value={(Math.min(total, Math.max(0, spent)) / total) * 100} aria-label={t("cabinet.termPeriod")} />
          <p className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{fmt.date(l.start_date)} — {fmt.date(l.end_date)}</span>
            <span>{l.status === "ended" ? t("cabinet.ended") : t("cabinet.daysLeft", { count: left })}</span>
          </p>
        </div>
      </Card>

      <Section title={t("cabinet.conditions")}>
        <dl className="divide-y divide-border rounded-xl border border-border bg-card px-4">
          {terms.map(([k, v]) => (
            <div key={k} className="flex min-h-12 items-center justify-between gap-3">
              <dt className="text-sm text-muted-foreground">{k}</dt>
              <dd className="text-right text-sm font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {items.length > 0 && (
        <Section title={t("cabinet.inventoryTitle")}>
          <ul className="grid gap-x-4 rounded-xl border border-border bg-card px-4 py-2 text-sm sm:grid-cols-2">
            {items.map((i) => (
              <li key={i} className="flex min-h-10 items-center gap-2">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
                {i}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <HouseRules lease={l} />

      <LandlordContact lease={l} />

      <LeaseRequestSection lease={l} />

      <nav aria-label={t("cabinet.details")} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <LinkRow to={`/cabinet?tab=payments&lease=${l.id}`} icon={<Wallet />} label={t("cabinet.openPayments")} />
        {mediaCount > 0 && <LinkRow to={`/cabinet/contracts/${l.id}/media`} icon={<Images />} label={t("cabinet.media")} count={mediaCount} />}
      </nav>

      {l.status === "ended" && <HideLease lease={l} />}
    </>
  );
}

export function ContractTab({ leases }: { leases: TenantLease[] | undefined }) {
  const { t } = useTranslation();
  const choice = useLeaseChoice(leases);
  if (!leases) return <Skeleton className="h-60 w-full" />;
  if (!choice.current) return <p className={EMPTY}>{t("cabinet.empty")}</p>;
  return (
    <>
      <LeasePicker leases={choice.leases} current={choice.current} onChange={choice.choose} />
      <LeaseTerms key={choice.current.id} lease={choice.current} />
    </>
  );
}
