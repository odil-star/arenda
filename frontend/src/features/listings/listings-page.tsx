import { Building2, Clock3, Home, LayoutGrid, Search, Shapes, ShieldCheck, Store, UserRoundCheck, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useListings, type ListingParams } from "@/api/listings";
import { PROPERTY_KINDS, type PropertyKind } from "@/api/types";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ListingCard, ListingCardSkeleton, ListingsLayout, OwnerCta } from "./listing-parts";

const PAGE_SIZE = 12;
type KindFilter = PropertyKind | "all";
type RoomsFilter = "all" | "1" | "2" | "3" | "4";
type Sort = "new" | "cheap" | "expensive";
const ORDERING: Record<Sort, string> = { new: "-updated_at", cheap: "listing_price", expensive: "-listing_price" };
const KIND_ICONS: Record<KindFilter, LucideIcon> = {
  all: LayoutGrid,
  apartment: Building2,
  house: Home,
  commercial: Store,
  other: Shapes,
};

/** Главная для гостей: свободные квартиры и дома, которые владельцы разрешили показывать. */
export function ListingsPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [params, setParams] = useSearchParams();
  const kind = (params.get("kind") as KindFilter | null) ?? "all";
  const rooms = (params.get("rooms") as RoomsFilter | null) ?? "all";
  const sort = (params.get("sort") as Sort | null) ?? "new";
  const page = Number(params.get("page") ?? 1) || 1;
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [priceMax, setPriceMax] = useState(params.get("price_max") ?? "");

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === "all") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  // поиск и цена применяются с задержкой, чтобы не дёргать API на каждую букву
  useEffect(() => {
    const id = window.setTimeout(() => {
      const digits = priceMax.replace(/\D/g, "");
      if ((params.get("q") ?? "") !== search.trim() || (params.get("price_max") ?? "") !== digits) {
        update({ q: search.trim(), price_max: digits });
      }
    }, 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, priceMax]);

  const query: ListingParams = {
    page,
    page_size: PAGE_SIZE,
    search: params.get("q") ?? undefined,
    kind: kind === "all" ? undefined : kind,
    rooms: rooms === "all" ? undefined : Number(rooms),
    owner: params.get("owner") ? Number(params.get("owner")) : undefined,
    price_max: params.get("price_max") ? Number(params.get("price_max")) : undefined,
    ordering: ORDERING[sort],
  };
  const listings = useListings(query);

  const roomOptions: SelectOption<RoomsFilter>[] = [
    { value: "all", label: t("listing.filters.anyRooms") },
    ...(["1", "2", "3", "4"] as const).map((r) => ({ value: r, label: t("listing.rooms", { count: Number(r) }) })),
  ];
  const sortOptions: SelectOption<Sort>[] = [
    { value: "new", label: t("listing.sort.new") },
    { value: "cheap", label: t("listing.sort.cheap") },
    { value: "expensive", label: t("listing.sort.expensive") },
  ];

  // активные фильтры — чипсы над выдачей, каждый можно снять отдельно
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (params.get("q")) {
    activeFilters.push({ key: "q", label: `«${params.get("q")}»`, clear: () => { setSearch(""); update({ q: "" }); } });
  }
  if (params.get("owner")) activeFilters.push({ key: "owner", label: t("listing.ownerFilter"), clear: () => update({ owner: "" }) });
  if (kind !== "all") activeFilters.push({ key: "kind", label: t(`properties.kind.${kind}`), clear: () => update({ kind: "" }) });
  if (rooms !== "all") {
    activeFilters.push({ key: "rooms", label: t("listing.rooms", { count: Number(rooms) }), clear: () => update({ rooms: "" }) });
  }
  if (params.get("price_max")) {
    activeFilters.push({
      key: "price",
      label: t("listing.priceUpTo", { price: fmt.money(params.get("price_max")) }),
      clear: () => { setPriceMax(""); update({ price_max: "" }); },
    });
  }
  const resetAll = () => {
    setSearch("");
    setPriceMax("");
    setParams(new URLSearchParams(sort === "new" ? {} : { sort }), { replace: true });
  };

  const data = listings.data;
  const trust = [
    { icon: UserRoundCheck, label: t("listing.trust.direct") },
    { icon: ShieldCheck, label: t("listing.trust.free") },
    { icon: Clock3, label: t("listing.trust.fast") },
  ];

  return (
    <ListingsLayout>
      {/* ---------- Hero + поиск ---------- */}
      <section className="relative -mx-4 mb-8 overflow-hidden px-4 pb-2 pt-10 sm:-mx-6 sm:px-6 sm:pt-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_-10%,var(--glow),transparent_60%)]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
        />

        <div className="relative max-w-3xl animate-rise-in">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            {t("listing.eyebrow")}
          </span>
          <h1 className="mt-4 font-display text-[30px] font-semibold leading-[1.1] tracking-tight text-balance sm:text-5xl">
            {t("listing.heroTitle")}
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground text-pretty sm:text-lg">{t("listing.heroText")}</p>
          <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {trust.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-1.5">
                <Icon className="size-4 text-primary" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>

        {/* тип объекта — крупные «таблетки» */}
        <div
          role="radiogroup"
          aria-label={t("properties.fields.kind")}
          className="relative mt-8 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0"
        >
          {(["all", ...PROPERTY_KINDS] as const).map((k) => {
            const Icon = KIND_ICONS[k];
            const active = kind === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update({ kind: k })}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card/80 text-foreground backdrop-blur hover:border-primary/40 hover:bg-muted",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {k === "all" ? t("listing.kindAll") : t(`properties.kind.${k}`)}
              </button>
            );
          })}
        </div>

        <div className="relative mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card/90 p-2 shadow-lg shadow-black/5 backdrop-blur sm:p-3 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)] dark:shadow-black/30">
          <label className="relative col-span-2 block lg:col-span-1">
            <span className="sr-only">{t("listing.filters.search")}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("listing.filters.searchPlaceholder")}
              className="pl-9"
              type="search"
            />
          </label>
          <Select aria-label={t("listing.fields.rooms")} value={rooms} onValueChange={(v) => update({ rooms: v })} options={roomOptions} />
          <MoneyInput
            aria-label={t("listing.filters.priceMax")}
            placeholder={t("listing.filters.priceMax")}
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            className="tabular"
          />
        </div>
      </section>

      {/* ---------- Панель над выдачей ---------- */}
      <div className="mb-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate font-display text-lg font-semibold" aria-live="polite">
            {data ? t("listing.found", { count: data.count }) : t("common.loading")}
          </h2>
          <Select
            aria-label={t("listing.sort.label")}
            value={sort}
            onValueChange={(v) => update({ sort: v === "new" ? "" : v })}
            options={sortOptions}
            className="w-auto min-w-36"
          />
        </div>
        {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={f.clear}
              aria-label={t("listing.removeFilter", { label: f.label })}
              className="flex h-8 items-center gap-1 rounded-full bg-accent pl-3 pr-2 text-xs font-medium text-accent-foreground transition hover:bg-accent/70"
            >
              <span className="max-w-40 truncate">{f.label}</span>
              <X className="size-3.5" aria-hidden />
            </button>
          ))}
          {activeFilters.length > 1 && (
            <button type="button" onClick={resetAll} className="h-8 px-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
              {t("listing.resetFilters")}
            </button>
          )}
        </div>
        )}
      </div>

      {/* ---------- Выдача ---------- */}
      {listings.isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label={t("common.loading")}>
          {Array.from({ length: 6 }, (_, i) => (
            <ListingCardSkeleton key={i} />
          ))}
        </div>
      ) : listings.isError ? (
        <ErrorState error={listings.error} onRetry={() => void listings.refetch()} retrying={listings.isRefetching} />
      ) : data && data.results.length > 0 ? (
        <>
          <div className={cn("grid gap-5 sm:grid-cols-2 lg:grid-cols-3 transition-opacity", listings.isPlaceholderData && "opacity-60")}>
            {data.results.map((l, i) => (
              <ListingCard key={l.id} listing={l} index={i} />
            ))}
          </div>
          <div className="mt-8">
            <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPageChange={(p) => update({ page: String(p) })} />
          </div>
        </>
      ) : (
        <EmptyState
          illustration="search"
          title={t("listing.emptyTitle")}
          description={t("listing.emptyText")}
          action={
            activeFilters.length > 0 ? (
              <Button variant="secondary" onClick={resetAll}>
                {t("listing.resetFilters")}
              </Button>
            ) : undefined
          }
          className="rounded-2xl border border-dashed border-border bg-card/50 py-14"
        />
      )}

      <OwnerCta />
    </ListingsLayout>
  );
}
