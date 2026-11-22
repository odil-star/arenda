import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, type SelectOption } from "@/components/ui/select";
import { Avatar, KindIcon } from "@/components/common/avatar";
import { DataList, type Column } from "@/components/common/data-list";
import { PageHeader } from "@/components/common/page-header";
import { RowActions } from "@/components/common/row-actions";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/states";
import { PropertyStatusBadge, type PropertyState } from "@/components/common/status-badges";
import { useCrudDialogs } from "@/components/common/use-crud-dialogs";
import { propertiesApi, useOccupiedPropertyIds } from "@/api/hooks";
import { PROPERTY_KINDS, type Paginated, type Property, type PropertyKind } from "@/api/types";
import { useFormat } from "@/lib/format";
import { useUrlState } from "@/lib/hooks";
import { InviteDialog } from "./invite-dialog";
import { PropertyFormDialog } from "./property-form-dialog";
import { useKindOptions } from "./use-kind-options";

const STATES = ["occupied", "vacant", "repair"] as const;

function isState(v: string): v is PropertyState {
  return (STATES as readonly string[]).includes(v);
}

/*
 * API объектов фильтрует только по is_under_repair, занятость не отдаёт.
 * «Сдан / Свободен» фильтруем на клиенте по действующим договорам,
 * поэтому при таком фильтре грузим страницы по 100 объектов.
 */
const CLIENT_FILTER_PAGE_SIZE = 100;

export function PropertiesPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { values, page, set } = useUrlState(["search", "kind", "state", "new"] as const);
  const kindOptions = useKindOptions();
  const kind = PROPERTY_KINDS.includes(values.kind as PropertyKind) ? (values.kind as PropertyKind) : undefined;

  const state = isState(values.state) ? values.state : undefined;
  const occupancyFilter = state === "occupied" || state === "vacant";
  const occupied = useOccupiedPropertyIds();

  const select = useCallback(
    (data: Paginated<Property>): Paginated<Property> => {
      if (!occupancyFilter) return data;
      // count оставляем серверным: по нему считаются страницы
      return { ...data, results: data.results.filter((p) => occupied.ids.has(p.id) === (state === "occupied")) };
    },
    [occupancyFilter, state, occupied.ids],
  );

  const query = propertiesApi.useList(
    {
      page,
      search: values.search,
      kind,
      is_under_repair: state === "repair" ? true : occupancyFilter ? false : undefined,
      page_size: occupancyFilter ? CLIENT_FILTER_PAGE_SIZE : undefined,
    },
    { select, enabled: !occupancyFilter || !occupied.isPending },
  );
  const [inviting, setInviting] = useState<Property | null>(null);
  const crud = useCrudDialogs<Property>(propertiesApi.useRemove(), t("properties.deleted"));
  const hasFilters = Boolean(values.search || values.kind || values.state);

  // «+ → Добавить объект» приходит сюда с ?new=1
  const openCreate = crud.openCreate;
  useEffect(() => {
    if (values.new) {
      openCreate();
      set("new", null);
    }
  }, [values.new, openCreate, set]);

  const allOption = { value: "all", label: t("common.all") } as const;
  const stateOptions: SelectOption[] = [allOption, ...STATES.map((s) => ({ value: s, label: t(`properties.state.${s}`) }))];

  const columns: Column<Property>[] = [
    {
      key: "name",
      header: t("properties.fields.name"),
      cell: (p) => (
        <span className="flex items-center gap-3">
          <KindIcon kind={p.kind} className="size-9" />
          <span className="min-w-0">
            <span className="block font-medium">{p.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{p.address}</span>
          </span>
        </span>
      ),
    },
    {
      key: "tenant",
      header: t("propertyHub.tenantColumn"),
      cell: (p) => {
        const lease = occupied.byProperty.get(p.id);
        return lease ? (
          <span className="flex items-center gap-2">
            <Avatar name={lease.tenant_name} size="sm" />
            <span className="truncate">{lease.tenant_name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      key: "area",
      header: t("properties.fields.areaShort"),
      align: "right",
      cell: (p) => (p.area_m2 ? t("properties.areaValue", { value: fmt.number(p.area_m2) }) : "—"),
    },
    { key: "status", header: t("common.status"), cell: (p) => <PropertyStatusBadge isUnderRepair={p.is_under_repair} occupied={occupied.ids.has(p.id)} /> },
  ];

  return (
    <>
      <PageHeader
        title={t("properties.title")}
        description={query.data && !occupancyFilter ? t("properties.count", { count: query.data.count }) : undefined}
        actions={
          <Button onClick={crud.openCreate}>
            <Plus aria-hidden />
            {t("properties.create")}
          </Button>
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_180px]">
        <SearchInput value={values.search} onChange={(v) => set("search", v)} placeholder={t("properties.searchPlaceholder")} />
        <Select
          aria-label={t("properties.fields.kind")}
          value={values.kind || "all"}
          onValueChange={(v) => set("kind", v === "all" ? null : v)}
          options={[allOption, ...kindOptions]}
        />
        <Select
          aria-label={t("common.status")}
          value={values.state || "all"}
          onValueChange={(v) => set("state", v === "all" ? null : v)}
          options={stateOptions}
        />
      </div>

      <DataList
        query={query}
        caption={t("properties.title")}
        columns={columns}
        page={page}
        pageSize={occupancyFilter ? CLIENT_FILTER_PAGE_SIZE : undefined}
        onPageChange={(p) => set("page", p)}
        rowHref={(p) => `/properties/${p.id}`}
        renderMobile={(p) => (
          <div className="flex gap-3">
            <KindIcon kind={p.kind} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{p.name}</p>
                <PropertyStatusBadge isUnderRepair={p.is_under_repair} occupied={occupied.ids.has(p.id)} />
              </div>
              <p className="text-sm text-muted-foreground">{p.address}</p>
              <p className="text-xs text-muted-foreground">
                {occupied.byProperty.get(p.id)?.tenant_name ?? t(`properties.kind.${p.kind}`)}
                {p.area_m2 ? ` · ${t("properties.areaValue", { value: fmt.number(p.area_m2) })}` : ""}
              </p>
            </div>
          </div>
        )}
        actions={(p) => <RowActions label={p.name} onEdit={() => crud.openEdit(p)} onDelete={() => crud.askDelete(p)} onInvite={() => setInviting(p)} />}
        empty={
          hasFilters ? (
            <EmptyState illustration="search" title={t("common.nothingFound")} description={t("common.nothingFoundHint")} />
          ) : (
            <EmptyState
              illustration="home"
              title={t("properties.emptyTitle")}
              description={t("properties.emptyDescription")}
              action={
                <Button onClick={crud.openCreate}>
                  <Plus aria-hidden />
                  {t("properties.create")}
                </Button>
              }
            />
          )
        }
      />

      <InviteDialog property={inviting} onClose={() => setInviting(null)} />
      <PropertyFormDialog open={crud.formOpen} onOpenChange={crud.setFormOpen} property={crud.editing} />
      <ConfirmDialog
        open={crud.deleting !== null}
        onOpenChange={(o) => !o && crud.cancelDelete()}
        title={t("properties.deleteTitle")}
        description={t("properties.deleteDescription", { name: crud.deleting?.name ?? "" })}
        confirmLabel={t("common.delete")}
        onConfirm={() => void crud.confirmDelete()}
        loading={crud.deletePending}
      />
    </>
  );
}
