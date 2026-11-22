import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataList, type Column } from "@/components/common/data-list";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { LeaseStatusBadge } from "@/components/common/status-badges";
import { leasesApi } from "@/api/hooks";
import { LEASE_STATUSES, type Lease, type LeaseStatus } from "@/api/types";
import { useFormat } from "@/lib/format";
import { useUrlState } from "@/lib/hooks";

const FILTERS = ["all", ...LEASE_STATUSES] as const;

export function LeasesPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { values, page, set } = useUrlState(["status"] as const);
  const status = LEASE_STATUSES.includes(values.status as LeaseStatus) ? (values.status as LeaseStatus) : undefined;
  const query = leasesApi.useList({ page, status });

  const period = (l: Lease) => `${fmt.date(l.start_date)} – ${fmt.date(l.end_date)}`;

  const columns: Column<Lease>[] = [
    { key: "property", header: t("leases.fields.property"), cell: (l) => l.property_name },
    { key: "tenant", header: t("leases.fields.tenant"), cell: (l) => l.tenant_name },
    { key: "period", header: t("leases.period"), cell: (l) => <span className="tabular text-muted-foreground">{period(l)}</span> },
    { key: "rent", header: t("leases.fields.rent"), align: "right", cell: (l) => fmt.money(l.rent_amount) },
    { key: "status", header: t("common.status"), cell: (l) => <LeaseStatusBadge status={l.status} /> },
  ];

  const createButton = (
    <Button asChild>
      <Link to="/leases/new">
        <Plus aria-hidden />
        {t("leases.create")}
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t("leases.title")}
        description={query.data ? t("leases.count", { count: query.data.count }) : undefined}
        actions={createButton}
      />

      <Tabs value={status ?? "all"} onValueChange={(v) => set("status", v === "all" ? null : v)} className="mb-4">
        <TabsList aria-label={t("common.status")}>
          {FILTERS.map((f) => (
            <TabsTrigger key={f} value={f}>
              {f === "all" ? t("common.all") : t(`leases.statusPlural.${f}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataList
        query={query}
        caption={t("leases.title")}
        columns={columns}
        page={page}
        onPageChange={(p) => set("page", p)}
        rowHref={(l) => `/leases/${l.id}`}
        renderMobile={(l) => (
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{l.property_name}</p>
              <LeaseStatusBadge status={l.status} />
            </div>
            <p className="text-sm text-muted-foreground">{l.tenant_name}</p>
            <p className="flex justify-between gap-2 text-xs text-muted-foreground tabular">
              <span>{period(l)}</span>
              <span className="font-medium text-foreground">{fmt.money(l.rent_amount)}</span>
            </p>
          </div>
        )}
        empty={
          <EmptyState
            illustration="document"
            title={status ? t(`leases.emptyFiltered.${status}`) : t("leases.emptyTitle")}
            description={t("leases.emptyDescription")}
            action={createButton}
          />
        }
      />
    </>
  );
}
