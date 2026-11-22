import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { DataList, type Column } from "@/components/common/data-list";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/states";
import { adminTenantsApi, type AdminTenant } from "@/api/admin";
import { useFormat } from "@/lib/format";
import { useUrlState } from "@/lib/hooks";
import { FilterBar } from "./filter-bar";
import { ExportButton } from "./export-button";

export function AdminTenantsTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { values, page, set } = useUrlState(["search"] as const);
  const query = adminTenantsApi.useList({ page, search: values.search });

  const account = (r: AdminTenant) =>
    r.has_account ? <Badge tone="success">{t("admin.tenants.hasAccount")}</Badge> : <Badge>{t("admin.tenants.noAccount")}</Badge>;

  const columns: Column<AdminTenant>[] = [
    { key: "name", header: t("admin.tenants.name"), cell: (r) => <span className="font-medium">{r.full_name}</span> },
    { key: "phone", header: t("admin.tenants.phone"), className: "tabular", cell: (r) => r.phone || "—" },
    { key: "owner", header: t("admin.tenants.owner"), cell: (r) => <span className="text-muted-foreground">{r.owner_email}</span> },
    { key: "leases", header: t("admin.tenants.leases"), align: "right", cell: (r) => fmt.number(r.leases_count) },
    { key: "account", header: t("admin.tenants.account"), cell: account },
  ];

  return (
    <>
      <FilterBar
        search={<SearchInput value={values.search} onChange={(v) => set("search", v)} placeholder={t("admin.tenants.search")} />}
        actions={<ExportButton path="/admin/tenants/" name="tenants" params={{ search: values.search }} />}
      />
      <DataList
        query={query}
        caption={t("admin.tabs.tenants")}
        columns={columns}
        page={page}
        onPageChange={(p) => set("page", p)}
        renderMobile={(r) => (
          <div className="space-y-0.5">
            <p className="flex items-center justify-between gap-2 font-medium">
              <span className="truncate">{r.full_name}</span>
              {account(r)}
            </p>
            <p className="text-sm tabular text-muted-foreground">{r.phone || "—"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {r.owner_email} · {t("admin.tenants.leases")}: {r.leases_count}
            </p>
          </div>
        )}
        empty={
          <EmptyState
            illustration={values.search ? "search" : "people"}
            title={values.search ? t("admin.tenants.emptySearch") : t("admin.tenants.empty")}
          />
        }
      />
    </>
  );
}
