import { useTranslation } from "react-i18next";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { ExportButton } from "./export-button";
import { DataList, type Column } from "@/components/common/data-list";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/states";
import { adminTransactionsApi, type AdminTransaction } from "@/api/admin";
import { useFormat } from "@/lib/format";
import { useUrlState } from "@/lib/hooks";
import { FilterBar } from "./filter-bar";

const STATE_TONE: Record<number, BadgeTone> = { 1: "info", 2: "success", [-1]: "neutral", [-2]: "danger" };

export function AdminPaymentsTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { values, page, set } = useUrlState(["search", "provider", "state", "problem"] as const);
  const provider = values.provider || "online";
  const state = values.state || "all";
  const problem = values.problem === "1";
  const filters = {
    search: values.search,
    provider: provider === "online" ? undefined : provider,
    state: state === "all" ? undefined : state,
    problem: problem ? "1" : undefined,
  };
  const query = adminTransactionsApi.useList({ page, ...filters });

  const stateBadge = (r: AdminTransaction) => <Badge tone={STATE_TONE[r.state] ?? "neutral"}>{r.state_label}</Badge>;
  const providerName = (r: AdminTransaction) =>
    r.provider === "manual" ? t("admin.payments.manual") : r.provider === "payme" ? "Payme" : "Click";

  const columns: Column<AdminTransaction>[] = [
    { key: "date", header: t("admin.payments.date"), cell: (r) => fmt.date(r.performed_at ?? r.created_at) },
    { key: "owner", header: t("admin.audit.owner"), cell: (r) => r.owner_email },
    { key: "provider", header: t("admin.payments.provider"), cell: providerName },
    { key: "ext", header: "ID", cell: (r) => <code className="text-xs">{r.external_id}</code> },
    { key: "amount", header: t("admin.payments.amount"), align: "right", cell: (r) => fmt.money(r.amount) },
    { key: "state", header: t("admin.payments.state"), cell: stateBadge },
  ];

  return (
    <>
      <FilterBar
        search={<SearchInput value={values.search} onChange={(v) => set("search", v)} placeholder={t("admin.payments.search")} />}
        active={(provider !== "online" ? 1 : 0) + (state !== "all" ? 1 : 0) + (problem ? 1 : 0)}
        actions={<ExportButton path="/admin/transactions/" name="payments" params={filters} />}
      >
        <div className="sm:w-48">
          <Select
            aria-label={t("admin.payments.provider")}
            value={provider}
            onValueChange={(v) => set("provider", v === "online" ? null : v)}
            options={[
              { value: "online", label: t("admin.payments.all") },
              { value: "payme", label: "Payme" },
              { value: "click", label: "Click" },
              { value: "manual", label: t("admin.payments.manual") },
            ]}
          />
        </div>
        <div className="sm:w-52">
          <Select
            aria-label={t("admin.payments.state")}
            value={state}
            onValueChange={(v) => set("state", v === "all" ? null : v)}
            options={[
              { value: "all", label: t("admin.payments.allStates") },
              { value: "1", label: t("admin.payments.states.created") },
              { value: "2", label: t("admin.payments.states.completed") },
              { value: "-1", label: t("admin.payments.states.cancelled") },
              { value: "-2", label: t("admin.payments.states.refunded") },
            ]}
          />
        </div>
        <button
          type="button"
          aria-pressed={problem}
          title={t("admin.payments.problemHint")}
          onClick={() => set("problem", problem ? null : "1")}
          className={
            "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border px-3 text-sm transition-colors sm:min-h-10 " +
            (problem ? "border-warning bg-warning-soft text-warning" : "border-border hover:bg-muted")
          }
        >
          {t("admin.payments.problem")}
        </button>
      </FilterBar>
      <DataList
        query={query}
        caption={t("admin.tabs.payments")}
        columns={columns}
        page={page}
        onPageChange={(p) => set("page", p)}
        renderMobile={(r) => (
          <div className="space-y-0.5">
            <p className="flex items-center justify-between gap-2 font-medium">
              <span>{fmt.money(r.amount)}</span>
              {stateBadge(r)}
            </p>
            <p className="truncate text-sm">{r.owner_email}</p>
            <p className="text-xs text-muted-foreground">
              {providerName(r)} · {fmt.date(r.performed_at ?? r.created_at)} · {r.external_id}
            </p>
          </div>
        )}
        empty={<EmptyState illustration="search" title={t("admin.payments.empty")} />}
      />
    </>
  );
}
