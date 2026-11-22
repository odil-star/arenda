import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { DataList, type Column } from "@/components/common/data-list";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/states";
import { adminWebhooksApi, type AdminWebhook } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { useUrlState } from "@/lib/hooks";
import { FilterBar } from "./filter-bar";

const stamp = (iso: string) => formatDateTime(iso, true);

const providerName = (p: AdminWebhook["provider"]) => (p === "payme" ? "Payme" : "Click");

function Json({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
      <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/50 p-3 text-xs leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

export function AdminWebhooksTab() {
  const { t } = useTranslation();
  const { values, page, set } = useUrlState(["search", "provider", "ok", "payment"] as const);
  const [open, setOpen] = useState<AdminWebhook>();
  const provider = values.provider === "payme" || values.provider === "click" ? values.provider : "all";
  const result = values.ok === "true" || values.ok === "false" ? values.ok : "all";
  const query = adminWebhooksApi.useList({
    page,
    search: values.search,
    provider: provider === "all" ? undefined : provider,
    ok: result === "all" ? undefined : result,
    payment: values.payment || undefined,
  });

  const resultBadge = (r: AdminWebhook) =>
    r.ok ? <Badge tone="success">{t("admin.webhooks.ok")}</Badge> : <Badge tone="danger">{t("admin.webhooks.error")}{r.error_code ? ` ${r.error_code}` : ""}</Badge>;

  const columns: Column<AdminWebhook>[] = [
    {
      key: "time",
      header: t("admin.webhooks.time"),
      className: "whitespace-nowrap tabular",
      cell: (r) => (
        <button type="button" className="hover:underline" onClick={() => setOpen(r)}>
          {stamp(r.created_at)}
        </button>
      ),
    },
    { key: "provider", header: t("admin.webhooks.provider"), cell: (r) => providerName(r.provider) },
    { key: "method", header: t("admin.webhooks.method"), cell: (r) => <code className="text-xs">{r.method || "—"}</code> },
    {
      key: "payment",
      header: t("admin.webhooks.payment"),
      className: "hidden xl:table-cell",
      cell: (r) =>
        r.payment_id ? (
          <button type="button" className="tabular hover:underline" onClick={() => set("payment", String(r.payment_id))}>
            №{r.payment_id}
          </button>
        ) : (
          "—"
        ),
    },
    { key: "result", header: t("admin.webhooks.result"), cell: resultBadge },
    {
      key: "duration",
      header: "",
      align: "right",
      className: "hidden xl:table-cell text-xs text-muted-foreground tabular",
      cell: (r) => t("admin.webhooks.duration", { ms: r.duration_ms }),
    },
  ];

  const filtered = Boolean(values.search || provider !== "all" || result !== "all" || values.payment);

  return (
    <>
      <FilterBar
        search={<SearchInput value={values.search} onChange={(v) => set("search", v)} placeholder={t("admin.webhooks.search")} />}
        active={(provider !== "all" ? 1 : 0) + (result !== "all" ? 1 : 0) + (values.payment ? 1 : 0)}
      >
        <div className="sm:w-48">
          <Select
            aria-label={t("admin.webhooks.provider")}
            value={provider}
            onValueChange={(v) => set("provider", v === "all" ? null : v)}
            options={[
              { value: "all", label: t("admin.webhooks.allProviders") },
              { value: "payme", label: "Payme" },
              { value: "click", label: "Click" },
            ]}
          />
        </div>
        <div className="sm:w-52">
          <Select
            aria-label={t("admin.webhooks.result")}
            value={result}
            onValueChange={(v) => set("ok", v === "all" ? null : v)}
            options={[
              { value: "all", label: t("admin.webhooks.all") },
              { value: "false", label: t("admin.webhooks.onlyErrors") },
              { value: "true", label: t("admin.webhooks.onlyOk") },
            ]}
          />
        </div>
        {values.payment && (
          <button
            type="button"
            onClick={() => set("payment", null)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm text-accent-foreground hover:bg-accent/70"
          >
            {t("admin.webhooks.paymentFilter", { id: values.payment })}
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </FilterBar>

      <DataList
        query={query}
        caption={t("admin.tabs.webhooks")}
        columns={columns}
        page={page}
        onPageChange={(p) => set("page", p)}
        renderMobile={(r) => (
          <button type="button" onClick={() => setOpen(r)} className="block w-full space-y-0.5 text-left">
            <p className="flex items-center justify-between gap-2 font-medium">
              <span>
                {providerName(r.provider)} · <code className="text-xs">{r.method || "—"}</code>
              </span>
              {resultBadge(r)}
            </p>
            <p className="text-xs tabular text-muted-foreground">
              {stamp(r.created_at)}
              {r.payment_id ? ` · №${r.payment_id}` : ""}
            </p>
          </button>
        )}
        empty={<EmptyState illustration="search" title={filtered ? t("admin.webhooks.emptyFiltered") : t("admin.webhooks.empty")} />}
      />

      <Dialog open={open !== undefined} onOpenChange={(o) => !o && setOpen(undefined)}>
        {open && (
          <DialogContent
            title={`${providerName(open.provider)} · ${open.method || "—"}`}
            description={`${stamp(open.created_at)} · ${t("admin.webhooks.duration", { ms: open.duration_ms })}${open.remote_addr ? ` · ${t("admin.webhooks.ip")} ${open.remote_addr}` : ""}`}
            className="sm:max-w-2xl"
            footer={
              <Button variant="secondary" onClick={() => setOpen(undefined)}>
                {t("admin.webhooks.close")}
              </Button>
            }
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {resultBadge(open)}
                {open.payment_id && <Badge tone="info">{t("admin.webhooks.payment")} №{open.payment_id}</Badge>}
                <span className="text-xs text-muted-foreground">{t("admin.webhooks.masked")}</span>
              </div>
              <Json title={t("admin.webhooks.requestTitle")} value={open.request} />
              <Json title={t("admin.webhooks.responseTitle")} value={open.response} />
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
