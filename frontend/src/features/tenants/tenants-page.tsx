import { FileSignature, Home, Phone, Plus, Send } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Avatar } from "@/components/common/avatar";
import { DataList, type Column } from "@/components/common/data-list";
import { PageHeader } from "@/components/common/page-header";
import { RowActions } from "@/components/common/row-actions";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/states";
import { useCrudDialogs } from "@/components/common/use-crud-dialogs";
import { tenantsApi, useOccupiedPropertyIds } from "@/api/hooks";
import type { Lease, Tenant } from "@/api/types";
import { useUrlState } from "@/lib/hooks";
import { TenantFormDialog } from "./tenant-form-dialog";

function PhoneLink({ phone }: { phone: string }) {
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="tabular hover:underline" onClick={(e) => e.stopPropagation()}>
      {phone}
    </a>
  );
}

/** Где живёт арендатор: ссылка на объект или кнопка «Оформить договор». */
function Residence({ tenant, lease, compact = false }: { tenant: Tenant; lease: Lease | undefined; compact?: boolean }) {
  const { t } = useTranslation();
  if (lease) {
    return (
      <Link
        to={`/properties/${lease.property}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
      >
        <Home className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{lease.property_name}</span>
      </Link>
    );
  }
  return (
    <Link
      to={`/leases/new?tenant=${tenant.id}`}
      onClick={(e) => e.stopPropagation()}
      className={compact ? "inline-flex items-center gap-1.5 text-primary hover:underline" : "inline-flex items-center gap-1.5 text-sm text-primary hover:underline"}
    >
      <FileSignature className="size-3.5 shrink-0" aria-hidden />
      {t("tenants.noLeaseAction")}
    </Link>
  );
}

export function TenantsPage() {
  const { t } = useTranslation();
  const { values, page, set } = useUrlState(["search", "new"] as const);
  const query = tenantsApi.useList({ page, search: values.search });
  const crud = useCrudDialogs<Tenant>(tenantsApi.useRemove(), t("tenants.deleted"));
  const occupied = useOccupiedPropertyIds();

  // «+ → Добавить арендатора» приходит сюда с ?new=1
  const openCreate = crud.openCreate;
  useEffect(() => {
    if (values.new) {
      openCreate();
      set("new", null);
    }
  }, [values.new, openCreate, set]);

  const columns: Column<Tenant>[] = [
    { key: "name", header: t("tenants.fields.fullName"), cell: (tn) => (
        <span className="flex items-center gap-3">
          <Avatar name={tn.full_name} />
          <span className="font-medium">{tn.full_name}</span>
        </span>
      ),
    },
    { key: "phone", header: t("tenants.fields.phone"), cell: (tn) => <PhoneLink phone={tn.phone} /> },
    {
      key: "residence",
      header: t("tenants.livesIn"),
      cell: (tn) => (occupied.isPending ? "—" : <Residence tenant={tn} lease={occupied.byTenant.get(tn.id)} />),
    },
    {
      key: "telegram",
      header: t("tenants.telegramConnected"),
      cell: (tn) =>
        tn.telegram_linked ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Send className="size-3.5" aria-hidden />
            {t("tenants.telegramConnected")}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("tenants.telegramNotLinked")}</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("tenants.title")}
        description={query.data ? t("tenants.count", { count: query.data.count }) : undefined}
        actions={
          <Button onClick={crud.openCreate}>
            <Plus aria-hidden />
            {t("tenants.create")}
          </Button>
        }
      />

      <SearchInput
        className="mb-4 sm:max-w-sm"
        value={values.search}
        onChange={(v) => set("search", v)}
        placeholder={t("tenants.searchPlaceholder")}
      />

      <DataList
        query={query}
        caption={t("tenants.title")}
        columns={columns}
        page={page}
        onPageChange={(p) => set("page", p)}
        renderMobile={(tn) => (
          <div className="flex items-center gap-3">
            <Avatar name={tn.full_name} size="lg" />
            <div className="min-w-0 space-y-0.5">
            <p className="font-medium">{tn.full_name}</p>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Phone className="size-3.5" aria-hidden />
              <PhoneLink phone={tn.phone} />
              {tn.telegram_linked && (
                <span className="inline-flex items-center gap-1 pl-2">
                  <Send className="size-3.5" aria-hidden />
                  <span className="sr-only sm:not-sr-only">{t("tenants.telegramConnected")}</span>
                </span>
              )}
            </p>
            {!occupied.isPending && (
              <p className="text-sm">
                <Residence tenant={tn} lease={occupied.byTenant.get(tn.id)} compact />
              </p>
            )}
            </div>
          </div>
        )}
        actions={(tn) => <RowActions label={tn.full_name} onEdit={() => crud.openEdit(tn)} onDelete={() => crud.askDelete(tn)} />}
        empty={
          values.search ? (
            <EmptyState illustration="search" title={t("common.nothingFound")} description={t("common.nothingFoundHint")} />
          ) : (
            <EmptyState
              illustration="people"
              title={t("tenants.emptyTitle")}
              description={t("tenants.emptyDescription")}
              action={
                <Button onClick={crud.openCreate}>
                  <Plus aria-hidden />
                  {t("tenants.create")}
                </Button>
              }
            />
          )
        }
      />

      <TenantFormDialog open={crud.formOpen} onOpenChange={crud.setFormOpen} tenant={crud.editing} />
      <ConfirmDialog
        open={crud.deleting !== null}
        onOpenChange={(o) => !o && crud.cancelDelete()}
        title={t("tenants.deleteTitle")}
        description={t("tenants.deleteDescription", { name: crud.deleting?.full_name ?? "" })}
        confirmLabel={t("common.delete")}
        onConfirm={() => void crud.confirmDelete()}
        loading={crud.deletePending}
      />
    </>
  );
}
