import { ArrowLeft, CalendarX2, Phone, UserPlus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, KindIcon } from "@/components/common/avatar";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { LeaseStatusBadge } from "@/components/common/status-badges";
import { errorKind, serverMessages } from "@/api/errors";
import { leasesApi, paymentsApi, propertiesApi, tenantsApi, useEndLease } from "@/api/hooks";
import type { Lease } from "@/api/types";
import { PaymentsList } from "@/features/payments/payments-list";
import { LeaseMediaSection } from "@/features/media/lease-media-section";
import { InviteDialog } from "@/features/properties/invite-dialog";
import { useFormat } from "@/lib/format";
import { PaymentStrip } from "./payment-strip";
import { PaymentDetailsCard } from "./payment-details-card";
import { InventoryCard } from "./inventory-card";

function Term({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular">{children}</dd>
    </div>
  );
}

function TenantContact({ id }: { id: number }) {
  const { data } = tenantsApi.useOne(id);
  if (!data?.phone) return null;
  return (
    <a href={`tel:${data.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary hover:underline sm:min-h-0">
      <Phone className="size-3.5" aria-hidden />
      {data.phone}
    </a>
  );
}

function LeaseSummary({ lease }: { lease: Lease }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const property = propertiesApi.useOne(lease.property);
  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Link to={`/properties/${lease.property}`} className="flex items-center gap-3 rounded-lg outline-offset-4 hover:opacity-90">
            {property.data ? <KindIcon kind={property.data.kind} /> : <Skeleton className="size-10 rounded-xl" />}
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">{t("leases.fields.property")}</span>
              <span className="block truncate font-medium">{lease.property_name}</span>
            </span>
          </Link>
          <div className="flex items-start gap-3">
            <Avatar name={lease.tenant_name} size="lg" className="size-10" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{t("leases.fields.tenant")}</p>
              <p className="truncate font-medium">{lease.tenant_name}</p>
              <TenantContact id={lease.tenant} />
            </div>
          </div>
        </div>

        <PaymentStrip leaseId={lease.id} />

        <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm sm:grid-cols-4">
          <Term label={t("leases.period")}>
            {fmt.date(lease.start_date)} – {fmt.date(lease.end_date)}
          </Term>
          <Term label={t("leases.fields.rent")}>{fmt.money(lease.rent_amount)}</Term>
          <Term label={t("leases.fields.deposit")}>{fmt.money(lease.deposit_amount)}</Term>
          <Term label={t("leases.fields.paymentDay")}>{t("leases.everyMonthOn", { day: lease.payment_day })}</Term>
        </dl>
        <PaymentDetailsCard lease={lease} />
        <InventoryCard lease={lease} />
        {lease.notes && <p className="whitespace-pre-line text-sm text-muted-foreground">{lease.notes}</p>}
      </CardContent>
    </Card>
  );
}

export function LeaseDetailPage() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const lease = leasesApi.useOne(id);
  const [page, setPage] = useState(1);
  const payments = paymentsApi.useList({ lease: id, page }, { enabled: lease.isSuccess });
  const endLease = useEndLease();
  const [confirmEnd, setConfirmEnd] = useState(false);
  // после оформления договора мастер открывает окно приглашения сразу
  const [inviting, setInviting] = useState(Boolean((useLocation().state as { invite?: boolean } | null)?.invite));
  const property = propertiesApi.useOne(lease.data?.property);

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-3">
      <Link to="/leases">
        <ArrowLeft aria-hidden />
        {t("leases.title")}
      </Link>
    </Button>
  );

  if (lease.isPending) {
    return (
      <div role="status" aria-label={t("common.loading")}>
        {back}
        <Skeleton className="mt-3 h-8 w-64" />
        <Skeleton className="mt-6 h-44 rounded-xl" />
        <Skeleton className="mt-4 h-64 rounded-xl" />
      </div>
    );
  }

  if (lease.isError) {
    return (
      <>
        {back}
        <Card className="mt-3">
          {errorKind(lease.error) === "notFound" ? (
            <EmptyState
              illustration="lost"
              title={t("leases.notFound")}
              action={
                <Button asChild variant="secondary">
                  <Link to="/leases">{t("leases.backToList")}</Link>
                </Button>
              }
            />
          ) : (
            <ErrorState error={lease.error} onRetry={() => void lease.refetch()} retrying={lease.isRefetching} />
          )}
        </Card>
      </>
    );
  }

  const data = lease.data;

  const onEnd = async () => {
    try {
      await endLease.mutateAsync(data.id);
      toast.success(t("leases.endedToast"));
      setConfirmEnd(false);
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
    }
  };

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t("leases.numbered", { id: data.id })}
            <LeaseStatusBadge status={data.status} />
          </span>
        }
        actions={
          data.status === "active" && (
            <>
              <Button onClick={() => setInviting(true)}>
                <UserPlus aria-hidden />
                {t("properties.invite.action")}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmEnd(true)}>
                <CalendarX2 aria-hidden />
                {t("leases.end")}
              </Button>
            </>
          )
        }
      />

      <div className="space-y-4">
        <LeaseSummary lease={data} />

        <LeaseMediaSection leaseId={data.id} canEdit />

        <section aria-labelledby="schedule-title">
          <CardHeader className="px-0 pb-3 sm:px-0">
            <CardTitle id="schedule-title">{t("leases.schedule")}</CardTitle>
          </CardHeader>
          <PaymentsList
            query={payments}
            caption={t("leases.schedule")}
            page={page}
            onPageChange={setPage}
            showLease={false}
            empty={<EmptyState illustration="coins" title={t("leases.noPayments")} description={t("leases.noPaymentsHint")} />}
          />
        </section>
      </div>

      <InviteDialog property={inviting ? property.data ?? null : null} onClose={() => setInviting(false)} />
      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title={t("leases.endTitle")}
        description={t("leases.endDescription")}
        confirmLabel={t("leases.end")}
        onConfirm={() => void onEnd()}
        loading={endLease.isPending}
      />
    </>
  );
}
