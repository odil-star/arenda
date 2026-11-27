import {
  AirVent, ArrowRight, ArrowUpRight, BedDouble, Building2, CookingPot, DoorOpen, Crown, Flame, Gem, House, ImageOff, KeyRound, Layers,
  Maximize2, MapPin, ChevronLeft, ChevronRight, Images, Microwave, Paintbrush, ParkingSquare, Refrigerator, Sofa, Sparkles, Tv, WashingMachine, Wifi, type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/layout/brand";
import { LanguageSwitcher } from "@/components/layout/preferences";
import { useTheme } from "@/lib/theme-context";
import { publicFileUrl, type Listing } from "@/api/listings";
import { useAuth } from "@/features/auth/auth-context";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Шапка и рамка публичных страниц поиска. */
export function ListingsLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { resolved } = useTheme();
  // публичные страницы объявлений: всегда светлая тема (без переключателя) и синий акцент
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.themeLock = "light";
    root.classList.remove("dark");
    root.classList.add("theme-blue");
    root.style.colorScheme = "light";
    return () => {
      delete root.dataset.themeLock;
      root.classList.remove("theme-blue");
      root.classList.toggle("dark", resolved === "dark");
      root.style.colorScheme = resolved;
    };
    // resolved нужен только при выходе; перезапуск эффекта при смене темы не нужен
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
          <Link to="/listings" aria-label={t("listing.home")}>
            <Brand />
          </Link>
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            {isAuthenticated ? (
              <Button asChild size="sm" variant="secondary" className="ml-1">
                <Link to="/">{t("listing.myCabinet")}</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="sm" variant="ghost" className="ml-1 hidden sm:inline-flex">
                  <Link to="/register">{t("listing.forOwners")}</Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link to="/login">{t("listing.signIn")}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6">{children}</main>
      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        {t("listing.contactTitle")}:{" "}
        <a href="mailto:ahmedovodil2002@gmail.com" className="font-medium text-foreground underline-offset-4 hover:underline">
          ahmedovodil2002@gmail.com
        </a>
      </footer>
    </div>
  );
}

export function ListingFacts({ listing, className }: { listing: Listing; className?: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground", className)}>
      <li>{t(`properties.kind.${listing.kind}`)}</li>
      {listing.rooms != null && (
        <li className="flex items-center gap-1">
          <BedDouble className="size-3.5" aria-hidden />
          {t("listing.rooms", { count: listing.rooms })}
        </li>
      )}
      {listing.area_m2 && (
        <li className="flex items-center gap-1">
          <Maximize2 className="size-3.5" aria-hidden />
          {t("properties.areaValue", { value: fmt.number(listing.area_m2) })}
        </li>
      )}
      {listing.floor != null && (
        <li>
          {listing.floors_total != null
            ? t("listing.floorOf", { floor: listing.floor, total: listing.floors_total })
            : t("listing.floorOnly", { floor: listing.floor })}
        </li>
      )}
    </ul>
  );
}

const AMENITY_ICONS: Record<string, LucideIcon> = {
  fridge: Refrigerator, washer: WashingMachine, ac: AirVent, tv: Tv, wifi: Wifi,
  oven: CookingPot, microwave: Microwave, heating: Flame, parking: ParkingSquare, balcony: DoorOpen,
};

/** Характеристики плитками с иконками. */
export function ListingDetails({ listing }: { listing: Listing }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const tiles: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: House, label: t("properties.fields.kind"), value: t(`properties.kind.${listing.kind}`) },
  ];
  if (listing.rooms != null) tiles.push({ icon: BedDouble, label: t("listing.fields.rooms"), value: String(listing.rooms) });
  if (listing.area_m2) tiles.push({ icon: Maximize2, label: t("properties.fields.areaShort"), value: t("properties.areaValue", { value: fmt.number(listing.area_m2) }) });
  if (listing.floor != null) tiles.push({ icon: Building2, label: t("listing.fields.floor"), value: String(listing.floor) });
  if (listing.floors_total != null) tiles.push({ icon: Layers, label: t("listing.fields.floorsTotal"), value: String(listing.floors_total) });
  if (listing.renovation) tiles.push({ icon: Paintbrush, label: t("listing.fields.renovation"), value: t(`listing.renovation.${listing.renovation}`) });
  if (listing.furniture) tiles.push({ icon: Sofa, label: t("listing.fields.furniture"), value: t(`listing.furniture.${listing.furniture}`) });
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{t("listing.details")}</h2>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {tiles.map(({ icon: Icon, label, value }) => (
          <li key={label} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-[18px]" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs text-muted-foreground">{label}</span>
              <span className="block truncate text-sm font-semibold">{value}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Что входит в квартиру: отдельные рамки с иконками. */
export function ListingAmenities({ listing }: { listing: Listing }) {
  const { t } = useTranslation();
  const items = listing.amenities ?? [];
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{t("listing.amenitiesIn")}</h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((a) => {
          const Icon = AMENITY_ICONS[a] ?? Sparkles;
          return (
            <li key={a} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <Icon className="size-4 text-primary" aria-hidden />
              {t(`listing.amenity.${a}`)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Местоположение: карта по адресу и ссылка «Открыть на карте». */
export function ListingLocation({ address }: { address: string }) {
  const { t, i18n } = useTranslation();
  const q = encodeURIComponent(address);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="p-4 pb-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("listing.location")}</h2>
        <p className="mt-2 flex items-start gap-1.5 text-sm font-medium">
          <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          {address}
        </p>
      </div>
      <iframe
        title={t("listing.location")}
        src={`https://www.google.com/maps?q=${q}&output=embed&hl=${i18n.language.slice(0, 2)}`}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-52 w-full border-0"
      />
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${q}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block border-t border-border px-4 py-2.5 text-sm text-primary hover:bg-muted/60"
      >
        {t("listing.openMap")}
      </a>
    </section>
  );
}

export function ListingPhoto({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  if (!src) {
    return (
      <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <ImageOff className="size-8" aria-hidden />
      </div>
    );
  }
  return <img src={publicFileUrl(src)} alt={alt} loading="lazy" className={cn("object-cover", className)} />;
}

const NEW_DAYS = 3;
export type CardVariant = "grid" | "list";

/** Фото карточки: если их несколько — стрелки и точки (листаются, не открывая объявление). */
function CardGallery({ listing, className }: { listing: Listing; className?: string }) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const total = listing.photos.length;
  const go = (delta: number) => setIdx((i) => (i + delta + total) % total);
  const arrow =
    "absolute top-1/2 z-20 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md transition hover:bg-background group-hover:flex group-focus-within:flex max-sm:flex";
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <ListingPhoto
        src={listing.photos[idx]}
        alt={listing.title}
        className="size-full min-h-full transition duration-500 group-hover:scale-[1.04]"
      />
      {total > 1 && (
        <>
          <button type="button" aria-label={t("listing.prevPhoto")} onClick={() => go(-1)} className={cn(arrow, "left-2")}>
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button type="button" aria-label={t("listing.nextPhoto")} onClick={() => go(1)} className={cn(arrow, "right-2")}>
            <ChevronRight className="size-4" aria-hidden />
          </button>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center gap-1">
            {listing.photos.slice(0, 7).map((_, i) => (
              <span key={i} className={cn("size-1.5 rounded-full bg-white/60 shadow", i === idx && "bg-white")} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ListingCard({ listing, index = 0, variant = "grid" }: { listing: Listing; index?: number; variant?: CardVariant }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const isNew = Date.now() - new Date(listing.updated_at).getTime() < NEW_DAYS * 86_400_000;
  const isList = variant === "list";
  return (
    <article
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className={cn(
        "group relative flex animate-rise-in overflow-hidden rounded-2xl border shadow-sm transition duration-300 [animation-fill-mode:backwards] hover:shadow-xl hover:shadow-black/5 focus-within:outline-2 focus-within:outline-ring dark:hover:shadow-black/40",
        // платные тарифы заметны сразу: VIP — тёплый золотой фон и рамка, Prime — холодный голубой
        listing.boost_tier === "vip"
          ? "border-2 border-warning bg-warning-soft shadow-md shadow-warning/20 hover:border-warning"
          : listing.boost_tier === "prime"
            ? "border-2 border-info bg-info-soft shadow-md shadow-info/20 hover:border-info"
            : "border-border bg-card hover:border-primary/40",
        isList ? "flex-col sm:flex-row" : "flex-col hover:-translate-y-1",
      )}
    >
      {/* вся карточка — одна ссылка; стрелки галереи лежат выше неё */}
      <Link to={`/listings/${listing.id}`} className="absolute inset-0 z-10 focus-visible:outline-none" aria-label={listing.title} />
      <div className={cn("relative", isList ? "sm:w-72 sm:shrink-0 lg:w-80" : "")}>
        <CardGallery listing={listing} className={isList ? "aspect-[4/3] w-full sm:aspect-auto sm:h-full" : "aspect-[4/3] w-full"} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/35 to-transparent" />
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur">
            {t(`properties.kind.${listing.kind}`)}
          </span>
          {listing.boosted && (
            <span className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white shadow-sm", listing.boost_tier === "vip" ? "bg-warning" : "bg-info")}>
              {listing.boost_tier === "vip" ? <Crown className="size-3" aria-hidden /> : <Gem className="size-3" aria-hidden />}
              {listing.boost_tier === "vip" ? "VIP" : "Prime"}
            </span>
          )}
          {isNew && (
            <span className="flex items-center gap-1 rounded-full bg-[linear-gradient(135deg,#8b5cf6,#d946ef_55%,#ec4899)] px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
              <Sparkles className="size-3" aria-hidden />
              {t("listing.isNew")}
            </span>
          )}
          {listing.photos.length > 1 && (
            <span className="flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-xs font-medium text-white backdrop-blur">
              <Images className="size-3" aria-hidden />
              {listing.photos.length}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="font-display tabular">
          <span className="text-xl font-semibold tracking-tight">{fmt.money(listing.price)}</span>{" "}
          <span className="text-sm text-muted-foreground">{t("listing.perMonthShort")}</span>
        </p>
        <p className="mt-1 line-clamp-1 font-medium transition-colors group-hover:text-primary">{listing.title}</p>
        <p className="text-xs text-muted-foreground tabular">{t("listing.id", { id: listing.id })}</p>
        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="line-clamp-1">{listing.address}</span>
        </p>
        {isList && listing.description && (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground max-sm:hidden">{listing.description}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/70 pt-3 [&:not(:first-child)]:mt-3.5">
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {listing.rooms != null && (
              <li className="flex items-center gap-1">
                <BedDouble className="size-3.5" aria-hidden />
                {t("listing.rooms", { count: listing.rooms })}
              </li>
            )}
            {listing.area_m2 && (
              <li className="flex items-center gap-1">
                <Maximize2 className="size-3.5" aria-hidden />
                {t("properties.areaValue", { value: fmt.number(listing.area_m2) })}
              </li>
            )}
            {listing.floor != null && (
              <li>
                {listing.floors_total != null
                  ? t("listing.floorOf", { floor: listing.floor, total: listing.floors_total })
                  : t("listing.floorOnly", { floor: listing.floor })}
              </li>
            )}
          </ul>
          <ArrowUpRight
            className="size-4 shrink-0 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
            aria-hidden
          />
        </div>
      </div>
    </article>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-6 w-2/5" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="mt-3 h-4 w-1/3" />
      </div>
    </div>
  );
}

/** Призыв для владельцев в конце ленты. */
export function OwnerCta() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  return (
    <section className="relative mt-14 overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-10">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-sand/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 size-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <span className="hidden size-12 shrink-0 items-center justify-center rounded-2xl bg-sand-soft text-sand sm:flex">
            <KeyRound className="size-6" aria-hidden />
          </span>
          <div className="max-w-xl">
            <h2 className="text-xl font-semibold sm:text-2xl">{t("listing.ownerTitle")}</h2>
            <p className="mt-1.5 text-muted-foreground">{t("listing.ownerText")}</p>
          </div>
        </div>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link to={isAuthenticated ? "/" : "/register"}>
            {t("listing.ownerCta")}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  );
}

/** Компактная карточка для ленты «Похожие объявления». */
export function SimilarCard({ listing }: { listing: Listing }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  return (
    <Link
      to={`/listings/${listing.id}`}
      className="group flex w-[260px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-ring sm:w-[280px]"
    >
      <ListingPhoto src={listing.photos[0]} alt={listing.title} className="aspect-[4/3] w-full" />
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <p className="line-clamp-2 min-h-10 text-sm font-medium leading-5 group-hover:text-primary">{listing.title}</p>
        <p className="font-display text-lg font-semibold tabular">
          {fmt.money(listing.price)} <span className="text-xs font-normal text-muted-foreground">{t("listing.perMonthShort")}</span>
        </p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{listing.address}</p>
        <div className="mt-auto flex items-center justify-between pt-2 text-xs text-muted-foreground">
          <span className="tabular">{fmt.date(listing.created_at)}</span>
          {listing.area_m2 && (
            <span className="flex items-center gap-1 tabular">
              <Maximize2 className="size-3.5" aria-hidden />
              {fmt.number(listing.area_m2)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
