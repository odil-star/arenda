import {
  Bell, Building2, Check, Clock3, Copy, Home, LayoutGrid, List, Map as MapIcon, Search, Shapes, ShieldCheck, SlidersHorizontal, Store,
  UserRoundCheck, X, type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/common/states";
import { toast } from "sonner";
import { useListings, useListingStats, useSaveSearch, type ListingParams, type SavedSearchLink } from "@/api/listings";
import { AMENITIES, FURNITURE, PROPERTY_KINDS, RENOVATIONS, type Amenity, type Furniture, type PropertyKind, type Renovation } from "@/api/types";
import { copyText } from "@/lib/clipboard";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ListingCard, ListingCardSkeleton, ListingsLayout, OwnerCta } from "./listing-parts";

const PAGE_SIZE = 12;
type KindFilter = PropertyKind | "all";
type RoomsFilter = "all" | "1" | "2" | "3" | "4";
type Sort = "new" | "cheap" | "expensive";
type View = "grid" | "list" | "map";
const ListingsMapView = lazy(() => import("./listings-map-view"));
/** Поля, которые вводятся текстом и применяются с задержкой. */
const TEXT_KEYS = ["q", "price_min", "price_max", "area_min", "area_max"] as const;
type TextKey = (typeof TEXT_KEYS)[number];
const normalize = (key: TextKey, value: string) =>
  key === "q" ? value.trim() : key.startsWith("area") ? value.replace(",", ".").replace(/[^\d.]/g, "") : value.replace(/\D/g, "");
const MAP_LIMIT = 100;
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
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const [params, setParams] = useSearchParams();
  const kind = (params.get("kind") as KindFilter | null) ?? "all";
  const rooms = (params.get("rooms") as RoomsFilter | null) ?? "all";
  const sort = (params.get("sort") as Sort | null) ?? "new";
  const view: View = params.get("view") === "list" ? "list" : params.get("view") === "map" ? "map" : "grid";
  const renovation = params.get("renovation") as Renovation | null;
  const furniture = params.get("furniture") as Furniture | null;
  const amenities = (params.get("amenities") ?? "").split(",").filter((a): a is Amenity => (AMENITIES as readonly string[]).includes(a));
  const newDays = params.get("new_days");
  const hasPhoto = params.get("has_photo") === "1";

  // «Показать ещё»: увеличиваем размер выдачи, сбрасываем при смене фильтров
  const [shown, setShown] = useState(PAGE_SIZE);
  const filterKey = ["q", "kind", "rooms", "owner", "price_min", "price_max", "area_min", "area_max", "renovation", "furniture", "amenities", "new_days", "has_photo", "sort", "view"]
    .map((k) => params.get(k) ?? "")
    .join("|");
  useEffect(() => setShown(PAGE_SIZE), [filterKey]);

  const [draft, setDraft] = useState<Record<TextKey, string>>(() =>
    Object.fromEntries(TEXT_KEYS.map((k) => [k, params.get(k) ?? ""])) as Record<TextKey, string>,
  );
  const [moreOpen, setMoreOpen] = useState(() => ["price_min", "area_min", "area_max", "renovation", "furniture", "amenities"].some((k) => params.get(k)));
  const [saved, setSaved] = useState<SavedSearchLink | null>(null);
  const saveSearch = useSaveSearch();

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === "all") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  // текстовые поля применяются с задержкой, чтобы не дёргать API на каждый символ
  useEffect(() => {
    const id = window.setTimeout(() => {
      const patch: Record<string, string> = {};
      for (const k of TEXT_KEYS) {
        const v = normalize(k, draft[k]);
        if ((params.get(k) ?? "") !== v) patch[k] = v;
      }
      if (Object.keys(patch).length > 0) update(patch);
    }, 400);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const setText = (k: TextKey, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const clearText = (k: TextKey) => {
    setText(k, "");
    update({ [k]: "" });
  };
  const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);

  const query: ListingParams = {
    page: 1,
    page_size: view === "map" ? MAP_LIMIT : shown,
    search: params.get("q") ?? undefined,
    kind: kind === "all" ? undefined : kind,
    rooms: rooms === "all" ? undefined : Number(rooms),
    owner: num("owner"),
    price_min: num("price_min"),
    price_max: num("price_max"),
    area_min: num("area_min"),
    area_max: num("area_max"),
    renovation: renovation ?? undefined,
    furniture: furniture ?? undefined,
    amenities: amenities.length > 0 ? amenities.join(",") : undefined,
    new_days: newDays ? Number(newDays) : undefined,
    has_photo: hasPhoto ? 1 : undefined,
    ordering: ORDERING[sort],
  };
  const listings = useListings(query);
  const stats = useListingStats();

  const roomOptions: SelectOption<RoomsFilter>[] = [
    { value: "all", label: t("listing.filters.anyRooms") },
    ...(["1", "2", "3", "4"] as const).map((r) => ({ value: r, label: t("listing.rooms", { count: Number(r) }) })),
  ];
  const sortOptions: SelectOption<Sort>[] = [
    { value: "new", label: t("listing.sort.new") },
    { value: "cheap", label: t("listing.sort.cheap") },
    { value: "expensive", label: t("listing.sort.expensive") },
  ];
  const renovationOptions: SelectOption<Renovation | "all">[] = [
    { value: "all", label: t("listing.filterPanel.anyRenovation") },
    ...RENOVATIONS.map((v) => ({ value: v, label: t(`listing.renovation.${v}`) })),
  ];
  const furnitureOptions: SelectOption<Furniture | "all">[] = [
    { value: "all", label: t("listing.filterPanel.anyFurniture") },
    ...FURNITURE.map((v) => ({ value: v, label: t(`listing.furniture.${v}`) })),
  ];

  // подборки: один клик — набор фильтров; повторный клик снимает
  const collections: { key: string; label: string; active: boolean; toggle: () => void }[] = [
    { key: "new", label: t("listing.collections.new"), active: newDays === "7", toggle: () => update({ new_days: newDays === "7" ? "" : "7" }) },
    { key: "cheap", label: t("listing.collections.cheap"), active: sort === "cheap", toggle: () => update({ sort: sort === "cheap" ? "" : "cheap" }) },
    { key: "photo", label: t("listing.collections.photo"), active: hasPhoto, toggle: () => update({ has_photo: hasPhoto ? "" : "1" }) },
    { key: "furnished", label: t("listing.collections.furnished"), active: furniture === "full", toggle: () => update({ furniture: furniture === "full" ? "" : "full" }) },
    { key: "euro", label: t("listing.collections.euro"), active: renovation === "euro", toggle: () => update({ renovation: renovation === "euro" ? "" : "euro" }) },
  ];

  // активные фильтры — чипсы над выдачей, каждый можно снять отдельно
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (params.get("q")) activeFilters.push({ key: "q", label: `«${params.get("q")}»`, clear: () => clearText("q") });
  if (params.get("owner")) activeFilters.push({ key: "owner", label: t("listing.ownerFilter"), clear: () => update({ owner: "" }) });
  if (kind !== "all") activeFilters.push({ key: "kind", label: t(`properties.kind.${kind}`), clear: () => update({ kind: "" }) });
  if (rooms !== "all") activeFilters.push({ key: "rooms", label: t("listing.rooms", { count: Number(rooms) }), clear: () => update({ rooms: "" }) });
  if (params.get("price_min")) {
    activeFilters.push({ key: "price_min", label: t("listing.chip.priceFrom", { price: fmt.money(params.get("price_min")) }), clear: () => clearText("price_min") });
  }
  if (params.get("price_max")) {
    activeFilters.push({ key: "price", label: t("listing.priceUpTo", { price: fmt.money(params.get("price_max")) }), clear: () => clearText("price_max") });
  }
  if (params.get("area_min")) {
    activeFilters.push({ key: "area_min", label: t("listing.chip.areaFrom", { value: params.get("area_min") }), clear: () => clearText("area_min") });
  }
  if (params.get("area_max")) {
    activeFilters.push({ key: "area_max", label: t("listing.chip.areaTo", { value: params.get("area_max") }), clear: () => clearText("area_max") });
  }
  if (renovation) activeFilters.push({ key: "renovation", label: t(`listing.renovation.${renovation}`), clear: () => update({ renovation: "" }) });
  if (furniture) activeFilters.push({ key: "furniture", label: t(`listing.furniture.${furniture}`), clear: () => update({ furniture: "" }) });
  for (const a of amenities) {
    activeFilters.push({ key: `amenity-${a}`, label: t(`listing.amenity.${a}`), clear: () => update({ amenities: amenities.filter((x) => x !== a).join(",") }) });
  }
  if (newDays) activeFilters.push({ key: "new_days", label: t("listing.collections.new"), clear: () => update({ new_days: "" }) });
  if (hasPhoto) activeFilters.push({ key: "has_photo", label: t("listing.collections.photo"), clear: () => update({ has_photo: "" }) });

  const advancedCount = ["price_min", "area_min", "area_max", "renovation", "furniture"].filter((k) => params.get(k)).length + (amenities.length > 0 ? 1 : 0);

  const resetAll = () => {
    setDraft({ q: "", price_min: "", price_max: "", area_min: "", area_max: "" });
    const keep = new URLSearchParams();
    if (sort !== "new") keep.set("sort", sort);
    if (view !== "grid") keep.set("view", view);
    setParams(keep, { replace: true });
  };

  const onSaveSearch = () => {
    const filters: Record<string, string> = {};
    for (const k of ["q", "kind", "rooms", "owner", "price_min", "price_max", "area_min", "area_max", "renovation", "furniture", "amenities", "new_days", "has_photo"]) {
      const v = params.get(k);
      if (v) filters[k === "q" ? "search" : k] = v;
    }
    saveSearch.mutate(
      { filters, language: i18n.language.startsWith("uz") ? "uz" : "ru" },
      { onSuccess: setSaved, onError: () => toast.error(t("listing.save.error")) },
    );
  };

  const data = listings.data;
  const trust = [
    { icon: UserRoundCheck, label: t("listing.trust.direct") },
    { icon: ShieldCheck, label: t("listing.trust.free") },
    { icon: Clock3, label: t("listing.trust.fast") },
  ];
  const statItems = stats.data
    ? [
        { value: fmt.number(stats.data.count), label: t("listing.stats.objects") },
        { value: fmt.number(stats.data.owners), label: t("listing.stats.owners") },
        ...(stats.data.min_price ? [{ value: fmt.compact(stats.data.min_price), label: t("listing.stats.from") }] : []),
        { value: fmt.number(stats.data.new_week), label: t("listing.stats.newWeek") },
      ]
    : [];
  const views: { id: View; icon: LucideIcon; label: string }[] = [
    { id: "grid", icon: LayoutGrid, label: t("listing.view.grid") },
    { id: "list", icon: List, label: t("listing.view.list") },
    { id: "map", icon: MapIcon, label: t("listing.view.map") },
  ];
  const chipClass = (on: boolean) =>
    cn(
      "flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
      on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-card/80 text-muted-foreground hover:bg-muted hover:text-foreground",
    );

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

        {statItems.length > 0 && (
          <dl className="relative mt-6 grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-4">
            {statItems.map((it) => (
              <div key={it.label} className="rounded-xl border border-border bg-card/80 px-3.5 py-2.5 backdrop-blur">
                <dd className="font-display text-xl font-semibold tabular">{it.value}</dd>
                <dt className="text-xs text-muted-foreground">{it.label}</dt>
              </div>
            ))}
          </dl>
        )}

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
                  "flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  active
                    ? "border-transparent bg-[linear-gradient(135deg,#f97316,#ec4899)] text-white shadow-md shadow-orange-500/30"
                    : "border-border bg-card/80 text-foreground backdrop-blur hover:border-fuchsia-400/50 hover:bg-muted",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {k === "all" ? t("listing.kindAll") : t(`properties.kind.${k}`)}
              </button>
            );
          })}
        </div>

        <div className="relative mt-3 rounded-2xl border border-border bg-card/90 p-2 shadow-lg shadow-black/5 backdrop-blur sm:p-3 dark:shadow-black/30">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="relative col-span-2 block lg:col-span-1">
              <span className="sr-only">{t("listing.filters.search")}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={draft.q}
                onChange={(e) => setText("q", e.target.value)}
                placeholder={t("listing.filters.searchPlaceholder")}
                className="pl-9"
                type="search"
              />
            </label>
            <Select aria-label={t("listing.fields.rooms")} value={rooms} onValueChange={(v) => update({ rooms: v })} options={roomOptions} />
            <MoneyInput
              aria-label={t("listing.filters.priceMax")}
              placeholder={t("listing.filters.priceMax")}
              value={draft.price_max}
              onChange={(e) => setText("price_max", e.target.value)}
              className="tabular"
            />
            <Button
              type="button"
              variant="secondary"
              className="col-span-2 lg:col-span-1"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}
            >
              <SlidersHorizontal aria-hidden />
              {advancedCount > 0 ? t("listing.moreFiltersCount", { count: advancedCount }) : t("listing.moreFilters")}
            </Button>
          </div>

          {moreOpen && (
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                <MoneyInput
                  aria-label={t("listing.filterPanel.priceMin")}
                  placeholder={t("listing.filterPanel.priceMin")}
                  value={draft.price_min}
                  onChange={(e) => setText("price_min", e.target.value)}
                  className="tabular"
                />
                <Input
                  aria-label={t("listing.filterPanel.areaMin")}
                  placeholder={t("listing.filterPanel.areaMin")}
                  inputMode="decimal"
                  value={draft.area_min}
                  onChange={(e) => setText("area_min", e.target.value)}
                  className="tabular"
                />
                <Input
                  aria-label={t("listing.filterPanel.areaMax")}
                  placeholder={t("listing.filterPanel.areaMax")}
                  inputMode="decimal"
                  value={draft.area_max}
                  onChange={(e) => setText("area_max", e.target.value)}
                  className="tabular"
                />
                <Select
                  aria-label={t("listing.fields.renovation")}
                  value={renovation ?? "all"}
                  onValueChange={(v) => update({ renovation: v })}
                  options={renovationOptions}
                />
                <Select
                  aria-label={t("listing.fields.furniture")}
                  value={furniture ?? "all"}
                  onValueChange={(v) => update({ furniture: v })}
                  options={furnitureOptions}
                />
              </div>
              <fieldset>
                <legend className="mb-2 text-xs font-medium text-muted-foreground">{t("listing.filterPanel.amenities")}</legend>
                <div className="flex flex-wrap gap-2">
                  {AMENITIES.map((a) => {
                    const on = amenities.includes(a);
                    return (
                      <label key={a} className={cn(chipClass(on), "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring")}>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={() => update({ amenities: (on ? amenities.filter((x) => x !== a) : [...amenities, a]).join(",") })}
                        />
                        {t(`listing.amenity.${a}`)}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          )}
        </div>

        {/* быстрые подборки */}
        <ul className="relative mt-3 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          {collections.map((c) => (
            <li key={c.key}>
              <button type="button" aria-pressed={c.active} onClick={c.toggle} className={chipClass(c.active)}>
                {c.active && <Check className="mr-1 size-3.5" aria-hidden />}
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- Панель над выдачей ---------- */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="min-w-0 truncate font-display text-lg font-semibold" aria-live="polite">
            {data ? t("listing.found", { count: data.count }) : t("common.loading")}
          </h2>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onSaveSearch} loading={saveSearch.isPending}>
              <Bell aria-hidden />
              <span className="max-sm:sr-only">{t("listing.save.button")}</span>
            </Button>
            <div role="group" aria-label={t("listing.view.label")} className="flex rounded-lg border border-border bg-card p-0.5">
              {views.map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={view === id}
                  aria-label={label}
                  title={label}
                  onClick={() => update({ view: id === "grid" ? "" : id })}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md transition focus-visible:outline-2 focus-visible:outline-ring",
                    view === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </button>
              ))}
            </div>
            <Select
              aria-label={t("listing.sort.label")}
              value={sort}
              onValueChange={(v) => update({ sort: v === "new" ? "" : v })}
              options={sortOptions}
              className="w-auto min-w-36"
            />
          </div>
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
        view === "map" ? (
          <Suspense fallback={<div className="h-[60dvh] animate-pulse rounded-2xl bg-muted" role="status" aria-label={t("common.loading")} />}>
            <ListingsMapView listings={data.results} />
          </Suspense>
        ) : (
          <>
            <div
              className={cn(
                "grid gap-5 transition-opacity",
                view === "grid" ? "sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1",
                listings.isPlaceholderData && "opacity-60",
              )}
            >
              {data.results.map((l, i) => (
                <ListingCard key={l.id} listing={l} index={i} variant={view === "list" ? "list" : "grid"} />
              ))}
            </div>
            {data.results.length < data.count && shown < 100 && (
              <div className="mt-8 flex justify-center">
                <Button variant="secondary" onClick={() => setShown((n) => Math.min(n + PAGE_SIZE, 100))} disabled={listings.isFetching}>
                  {t("listing.showMore")}
                </Button>
              </div>
            )}
          </>
        )
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

      <Dialog open={saved !== null} onOpenChange={(open) => !open && setSaved(null)}>
        {saved && (
          <DialogContent title={t("listing.save.title")} description={t("listing.save.text")}>
            <div className="space-y-4">
              {saved.link && (
                <Button asChild className="w-full">
                  <a href={saved.link} target="_blank" rel="noopener noreferrer">
                    {t("listing.save.open")}
                  </a>
                </Button>
              )}
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t("listing.save.orSend")}</p>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2">
                  <code className="min-w-0 flex-1 break-all text-xs">{saved.start_command}</code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      if (await copyText(saved.start_command)) toast.success(t("listing.save.copied"));
                    }}
                  >
                    <Copy aria-hidden />
                    {t("listing.save.copy")}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </ListingsLayout>
  );
}
