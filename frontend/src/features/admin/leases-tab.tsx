import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { DataList, type Column } from "@/components/common/data-list";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/states";
import { adminLeasesApi, type AdminLease } from "@/api/admin";
import { useFormat } from "@/lib/format";
import { useUrlState } from "@/lib/hooks";
import { FilterBar } from "./filter-bar";
import { ExportButton } from "./export-button";

export function AdminLeasesTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { values, page, set } = useUrlState(["search", "status"] as const);
  const status = values.status === "active" || values.status === "ended" ? values.status : "all";
  const filters = { search: values.search, status: status === "all" ? undefined : status };
  const query = adminLeasesApi.useList({ page, ...filters });

  const statusBadge = (r: AdminLease) => (
    <Badge tone={r.status === "active" ? "success" : "neutral"}>
      {r.status === "active" ? t("admin.leases.active") : t("admin.leases.ended")}
    </Badge>
  );
  const period = (r: AdminLease) => `${fmt.date(r.start_date)} — ${fmt.date(r.end_date)}`;

  const columns: Column<AdminLease>[] = [
    { key: "property", header: t("admin.leases.property"), cell: (r) => <span className="font-medium">{r.property_name}</span> },
    { key: "tenant", header: t("admin.leases.tenant"), cell: (r) => r.tenant_name },
    { key: "owner", header: t("admin.leases.owner"), className: "hidden xl:table-cell", cell: (r) => <span className="text-muted-foreground">{r.owner_email}</span> },
    { key: "period", header: t("admin.leases.period"), className: "whitespace-nowrap", cell: period },
    { key: "rent", header: t("admin.leases.rent"), align: "right", cell: (r) => fmt.money(r.rent_amount) },
    { key: "status", header: t("admin.leases.status"), cell: statusBadge },
  ];

  return (
    <>
      <FilterBar
        search={<SearchInput value={values.search} onChange={(v) => set("search", v)} placeholder={t("admin.leases.search")} />}
        active={status !== "all" ? 1 : 0}
        actions={<ExportButton path="/admin/leases/" name="leases" params={filters} />}
      >
        <div className="sm:w-52">
          <Select
            aria-label={t("admin.leases.status")}
            value={status}
            onValueChange={(v) => set("status", v === "all" ? null : v)}
            options={[
              { value: "all", label: t("admin.leases.filterAll") },
              { value: "active", label: t("admin.leases.filterActive") },
              { value: "ended", label: t("admin.leases.filterEnded") },
            ]}
          />
        </div>
      </FilterBar>
      <DataList
        query={query}
        caption={t("admin.tabs.leases")}
        columns={columns}
        page={page}
        onPageChange={(p) => set("page", p)}
        renderMobile={(r) => (
          <div className="space-y-0.5">
            <p className="flex items-center justify-between gap-2 font-medium">
              <span className="truncate">{r.property_name}</span>
              {statusBadge(r)}
            </p>
            <p className="truncate text-sm">
              {r.tenant_name} · <span className="tabular">{fmt.money(r.rent_amount)}</span>
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {r.owner_email} · {period(r)}
            </p>
          </div>
        )}
        empty={
          <EmptyState
            illustration="search"
            title={values.search || status !== "all" ? t("admin.leases.emptySearch") : t("admin.leases.empty")}
          />
        }
      />
    </>
  );
}
