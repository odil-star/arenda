import { ArrowLeft, CalendarClock, ChevronRight, FileText, Globe, Hammer, MapPin, MoreHorizontal, Pencil, Phone, Trash2, UserPlus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, KindIcon } from "@/components/common/avatar";
import { EmptyState, ErrorState } from "@/components/common/states";
import { LeaseStatusBadge, PaymentStatusBadge, PropertyStatusBadge } from "@/components/common/status-badges";
import { useCrudDialogs } from "@/components/common/use-crud-dialogs";
import { errorKind } from "@/api/errors";
import { leasesApi, paymentsApi, propertiesApi, tenantsApi } from "@/api/hooks";
import type { Lease, Payment, Property } from "@/api/types";
import { PaymentStrip } from "@/features/leases/payment-strip";
import { PayDialog } from "@/features/payments/pay-dialog";
import { todayISO, useFormat } from "@/lib/format";
import { InviteDialog } from "./invite-dialog";
import { PropertyFormDialog } from "./property-form-dialog";
import { PropertyPhotos } from "./property-photos";

/*
 * Страница объекта — центр работы с арендой:
 * кто живёт сейчас, следующий платёж и долг, лента платежей, история договоров.
 */

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular">{children}</dd>
    </div>
  );
}

function TenantPhone({ id }: { id: number }) {
  const { data } = tenantsApi.useOne(id);
  if (!data?.phone) return null;
  return (
    <a
      href={`tel:${data.phone.replace(/[^\d+]/g, "")}`}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary hover:underline sm:min-h-0"
    >
      <Phone className="size-3.5" aria-hidden />
      {data.phone}
    </a>
  );
}

/** Срок договора; за 30 дней до конца — заметное напоминание о продлении. */
function LeaseEnd({ endDate, leaseId }: { endDate: string; leaseId: number }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const left = -fmt.daysFromToday(endDate);
  if (left > 30) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CalendarClock className="size-4 shrink-0" aria-hidden />
        {t("propertyHub.leaseUntil", { date: fmt.date(endDate) })}
      </p>
    );
  }
  return (
    <Link
      to={`/leases/${leaseId}`}
      className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning hover:bg-warning-soft/80"
    >
      <CalendarClock className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 font-medium">
        {left < 0
          ? t("propertyHub.leaseEnded", { date: fmt.date(endDate) })
          : left === 0
            ? t("propertyHub.leaseEndsToday")
            : t("propertyHub.leaseEndsSoon", { count: left, date: fmt.date(endDate) })}
      </span>
      <ChevronRight className="size-4 shrink-0" aria-hidden />
    </Link>
  );
}

/** Карточка «Сейчас живёт»: жилец, следующий платёж, долг, быстрые действия. */
function CurrentLease({ lease }: { lease: Lease }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  // тот же ключ, что у PaymentStrip — запрос один на оба блока
  const payments = paymentsApi.useList({ lease: lease.id, page_size: 60, ordering: "due_date" });
  const [paying, setPaying] = useState<Payment | null>(null);

  const { next, debt, debtCount } = useMemo(() => {
    const list = payments.data?.results ?? [];
    const today = todayISO();
    const unpaid = list.filter((p) => p.remaining > 0);
    const late = unpaid.filter((p) => p.due_date < today);
    return {
      next: unpaid[0] ?? null,
      debt: late.reduce((sum, p) => sum + p.remaining, 0),
      debtCount: late.length,
    };
  }, [payments.data]);

  return (
    <Card className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,var(--glow),transparent_40%)] opacity-60" />
      <CardContent className="relative space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={lease.tenant_name} size="lg" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("propertyHub.livesNow")}</p>
              <p className="truncate font-display text-lg font-semibold">{lease.tenant_name}</p>
              <TenantPhone id={lease.tenant} />
            </div>
          </div>
          {/* на телефоне блок переносится под жильца — тогда выравниваем влево */}
          <div className="w-full sm:w-auto sm:text-right">
            <p className="text-xs text-muted-foreground">{t("leases.fields.rent")}</p>
            <p className="font-display text-2xl font-semibold tabular">{fmt.money(lease.rent_amount)}</p>
            <p className="text-xs text-muted-foreground">{t("leases.everyMonthOn", { day: lease.payment_day })}</p>
          </div>
        </div>

        <LeaseEnd endDate={lease.end_date} leaseId={lease.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-background/40 p-3">
            <p className="text-xs text-muted-foreground">{t("propertyHub.nextPayment")}</p>
            {payments.isPending ? (
              <Skeleton className="mt-1.5 h-5 w-40" />
            ) : next ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-semibold tabular">{fmt.money(next.remaining)}</span>
                <span className="text-sm text-muted-foreground tabular">· {fmt.date(next.due_date)}</span>
                <PaymentStatusBadge status={next.status} />
              </div>
            ) : (
              <p className="mt-1 text-sm font-medium text-success">{t("propertyHub.allPaid")}</p>
            )}
          </div>
          <div className={debt > 0 ? "rounded-xl border border-danger/30 bg-danger-soft p-3" : "rounded-xl border border-border bg-background/40 p-3"}>
            <p className="text-xs text-muted-foreground">{t("propertyHub.debt")}</p>
            {payments.isPending ? (
              <Skeleton className="mt-1.5 h-5 w-32" />
            ) : debt > 0 ? (
              <p className="mt-1 font-semibold text-danger tabular">
                {fmt.money(debt)}{" "}
                <span className="text-sm font-normal">· {t("dashboard.overdueCount", { count: debtCount })}</span>
              </p>
            ) : (
              <p className="mt-1 text-sm font-medium text-success">{t("propertyHub.noDebt")}</p>
            )}
          </div>
        </div>

        <PaymentStrip leaseId={lease.id} />

        <div className="flex flex-wrap gap-2">
          {next && (
            <Button onClick={() => setPaying(next)}>{t("payments.markPaid")}</Button>
          )}
          <Button asChild variant="secondary">
            <Link to={`/leases/${lease.id}`}>
              <FileText aria-hidden />
              {t("propertyHub.openLease")}
            </Link>
          </Button>
        </div>
      </CardContent>
      <PayDialog payment={paying} onOpenChange={(o) => !o && setPaying(null)} />
    </Card>
  );
}

function VacantCard({ property, onInvite }: { property: Property; onInvite: () => void }) {
  const { t } = useTranslation();
  if (property.is_under_repair) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning">
            <Hammer className="size-5" aria-hidden />
          </span>
          <div>
            <p className="font-semibold">{t("propertyHub.repairTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("propertyHub.repairHint")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <EmptyState
        illustration="home"
        title={t("propertyHub.vacantTitle")}
        description={t("propertyHub.vacantHint")}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link to={`/leases/new?property=${property.id}`}>{t("propertyHub.createLease")}</Link>
            </Button>
            <Button variant="secondary" onClick={onInvite}>
              <UserPlus aria-hidden />
              {t("properties.invite.action")}
            </Button>
          </div>
        }
      />
    </Card>
  );
}

function LeaseHistory({ leases }: { leases: Lease[] }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("propertyHub.history")}</CardTitle>
      </CardHeader>
      {leases.length === 0 ? (
        <p className="px-4 pb-5 pt-2 text-sm text-muted-foreground sm:px-5">{t("propertyHub.noHistory")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {leases.map((l) => (
            <li key={l.id}>
              <Link to={`/leases/${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60 sm:px-5">
                <Avatar name={l.tenant_name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.tenant_name}</span>
                  <span className="block text-xs text-muted-foreground tabular">
                    {fmt.date(l.start_date)} – {fmt.date(l.end_date)}
                  </span>
                </span>
                <LeaseStatusBadge status={l.status} />
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Публикация в поиске квартир: статус, цена, ссылка на объявление. */
function ListingCard({ property: p, occupied, onEdit }: { property: Property; occupied: boolean; onEdit: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const visible = p.is_listed && !occupied && !p.is_under_repair;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" aria-hidden />
          {t("listing.cardTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!p.is_listed ? (
          <p className="text-muted-foreground">{t("listing.notListed")}</p>
        ) : (
          <>
            <p className="font-display text-xl font-semibold tabular">
              {p.listing_price ? t("listing.perMonth", { price: fmt.money(p.listing_price) }) : "—"}
            </p>
            <p className={visible ? "text-success" : "text-warning"}>
              {visible ? t("listing.visible") : occupied ? t("listing.hiddenOccupied") : t("listing.hiddenRepair")}
            </p>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Pencil aria-hidden />
            {p.is_listed ? t("listing.edit") : t("listing.publish")}
          </Button>
          {visible && (
            <Button asChild variant="ghost" size="sm">
              <Link to={`/listings/${p.id}`} target="_blank" rel="noopener">
                {t("listing.open")}
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PropertyDetailPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const id = Number(useParams().id);
  const property = propertiesApi.useOne(id);
  const leases = leasesApi.useList({ property: id, page_size: 50 }, { enabled: property.isSuccess });
  const [inviting, setInviting] = useState(false);
  const crud = useCrudDialogs<Property>(propertiesApi.useRemove(), t("properties.deleted"));

  const active = leases.data?.results.find((l) => l.status === "active") ?? null;
  const history = (leases.data?.results ?? []).filter((l) => l.id !== active?.id);

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-3">
      <Link to="/properties">
        <ArrowLeft aria-hidden />
        {t("properties.title")}
      </Link>
    </Button>
  );

  if (property.isPending) {
    return (
      <div role="status" aria-label={t("common.loading")} className="space-y-4">
        {back}
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (property.isError) {
    return (
      <>
        {back}
        <Card className="mt-3">
          {errorKind(property.error) === "notFound" ? (
            <EmptyState illustration="lost" title={t("propertyHub.notFound")} />
          ) : (
            <ErrorState error={property.error} onRetry={() => void property.refetch()} retrying={property.isRefetching} />
          )}
        </Card>
      </>
    );
  }

  const p = property.data;

  // после удаления уходим к списку
  const confirmDelete = async () => {
    if (await crud.confirmDelete()) navigate("/properties", { replace: true });
  };

  return (
    <>
      <div className="mb-5 space-y-3 sm:mb-6">
        {back}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <KindIcon kind={p.kind} className="size-14 rounded-2xl [&_svg]:size-6" />
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-semibold tracking-tight sm:text-[28px]">{p.name}</h1>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{p.address}</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => crud.openEdit(p)}>
              <Pencil aria-hidden />
              {t("common.edit")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label={t("common.actionsFor", { name: p.name })}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setInviting(true)}>
                  <UserPlus aria-hidden />
                  {t("properties.invite.action")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => crud.askDelete(p)} className="text-danger [&_svg]:!text-danger">
                  <Trash2 aria-hidden />
                  {t("common.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {leases.isPending ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : leases.isError ? (
            <Card>
              <ErrorState error={leases.error} onRetry={() => void leases.refetch()} retrying={leases.isRefetching} />
            </Card>
          ) : active ? (
            <CurrentLease lease={active} />
          ) : (
            <VacantCard property={p} onInvite={() => setInviting(true)} />
          )}
          {leases.isSuccess && <LeaseHistory leases={history} />}
          <PropertyPhotos propertyId={p.id} isListed={p.is_listed} />
        </div>

        <div className="h-fit space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("propertyHub.about")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Fact label={t("common.status")}>
                <PropertyStatusBadge isUnderRepair={p.is_under_repair} occupied={Boolean(active)} />
              </Fact>
              <Fact label={t("properties.fields.kind")}>{t(`properties.kind.${p.kind}`)}</Fact>
              <Fact label={t("properties.fields.areaShort")}>
                {p.area_m2 ? t("properties.areaValue", { value: fmt.number(p.area_m2) }) : "—"}
              </Fact>
              <Fact label={t("propertyHub.leasesTotal")}>{leases.data?.count ?? "—"}</Fact>
            </dl>
            {p.notes && (
              <p className="mt-4 whitespace-pre-line border-t border-border pt-4 text-sm text-muted-foreground">{p.notes}</p>
            )}
          </CardContent>
        </Card>
        <ListingCard property={p} occupied={Boolean(active)} onEdit={() => crud.openEdit(p)} />
        </div>
      </div>

      <InviteDialog property={inviting ? p : null} onClose={() => setInviting(false)} />
      <PropertyFormDialog open={crud.formOpen} onOpenChange={crud.setFormOpen} property={crud.editing} />
      <ConfirmDialog
        open={crud.deleting !== null}
        onOpenChange={(o) => !o && crud.cancelDelete()}
        title={t("properties.deleteTitle")}
        description={t("properties.deleteDescription", { name: p.name })}
        confirmLabel={t("common.delete")}
        onConfirm={() => void confirmDelete()}
        loading={crud.deletePending}
      />
    </>
  );
}
