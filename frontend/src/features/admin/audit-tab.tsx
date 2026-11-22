import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DataList, type Column } from "@/components/common/data-list";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/states";
import { adminAuditApi, useAdminAuditActions, type AdminAuditEntry } from "@/api/admin";
import { ExportButton } from "./export-button";
import { formatDateTime } from "@/lib/format";
import { useUrlState } from "@/lib/hooks";
import { FilterBar } from "./filter-bar";

const when = (iso: string) => formatDateTime(iso);

export function AdminAuditTab() {
  const { t } = useTranslation();
  const { values, page, set } = useUrlState(["search", "action", "from", "to"] as const);
  const actions = useAdminAuditActions();
  const filters = { search: values.search, action: values.action, date_from: values.from, date_to: values.to };
  const query = adminAuditApi.useList({ page, ...filters });
  const filtered = Boolean(values.action || values.from || values.to);

  /** Понятное название действия; незнакомые коды показываем как есть. */
  const names = t("admin.audit.names", { returnObjects: true }) as Record<string, string>;
  const actionName = (code: string) => names[code] ?? code;

  const actor = (e: AdminAuditEntry) => e.actor_email ?? t("admin.audit.system");
  const object = (e: AdminAuditEntry) => (e.object_type ? `${e.object_type}${e.object_id ? ` #${e.object_id}` : ""}` : "—");

  const columns: Column<AdminAuditEntry>[] = [
    { key: "when", header: t("admin.audit.when"), className: "whitespace-nowrap tabular", cell: (e) => when(e.created_at) },
    {
      key: "owner",
      header: t("admin.audit.owner"),
      cell: (e) => (
        <>
          <span className="block">{e.owner_email}</span>
          {/* на узких экранах колонка «Кто» скрыта — показываем её второй строкой */}
          <span className="block text-xs text-muted-foreground xl:hidden">{actor(e)}</span>
        </>
      ),
    },
    { key: "actor", header: t("admin.audit.actor"), className: "hidden xl:table-cell", cell: (e) => <span className="text-muted-foreground">{actor(e)}</span> },
    { key: "action", header: t("admin.audit.action"), cell: (e) => <span title={e.action}>{actionName(e.action)}</span> },
    { key: "object", header: t("admin.audit.object"), className: "hidden xl:table-cell", cell: (e) => <span className="text-muted-foreground">{object(e)}</span> },
  ];

  return (
    <>
      <FilterBar
        search={<SearchInput value={values.search} onChange={(v) => set("search", v)} placeholder={t("admin.audit.search")} />}
        active={[values.action, values.from, values.to].filter(Boolean).length}
        actions={<ExportButton path="/admin/audit/" name="audit" params={filters} />}
      >
        <div className="sm:w-56">
          <Select
            aria-label={t("admin.audit.action")}
            value={values.action || "all"}
            onValueChange={(v) => set("action", v === "all" ? null : v)}
            options={[
              { value: "all", label: t("admin.audit.allActions") },
              ...(actions.data ?? []).map((a) => ({ value: a, label: actionName(a) })),
            ]}
          />
        </div>
        <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
          {t("admin.audit.dateFrom")}
          <Input type="date" className="w-auto flex-1 sm:flex-none" value={values.from} max={values.to || undefined} onChange={(e) => set("from", e.target.value || null)} />
        </label>
        <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
          {t("admin.audit.dateTo")}
          <Input type="date" className="w-auto flex-1 sm:flex-none" value={values.to} min={values.from || undefined} onChange={(e) => set("to", e.target.value || null)} />
        </label>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              set("action", null);
              set("from", null);
              set("to", null);
            }}
          >
            {t("admin.audit.reset")}
          </Button>
        )}
      </FilterBar>
      <DataList
        query={query}
        caption={t("admin.tabs.audit")}
        columns={columns}
        page={page}
        onPageChange={(p) => set("page", p)}
        renderMobile={(e) => (
          <div className="space-y-0.5">
            <p className="flex justify-between gap-2">
              <span className="text-sm font-medium" title={e.action}>{actionName(e.action)}</span>
              <span className="text-xs tabular text-muted-foreground">{when(e.created_at)}</span>
            </p>
            <p className="truncate text-sm">{e.owner_email}</p>
            <p className="truncate text-xs text-muted-foreground">{actor(e)} · {object(e)}</p>
          </div>
        )}
        empty={<EmptyState illustration="search" title={t("admin.audit.empty")} />}
      />
    </>
  );
}
