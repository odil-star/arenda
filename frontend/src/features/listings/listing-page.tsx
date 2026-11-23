import { ArrowLeft, ChevronLeft, ChevronRight, ImageOff, Images, MapPin, MessageCircle, Phone, Share2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Lightbox } from "@/components/common/lightbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/common/states";
import { errorKind } from "@/api/errors";
import { publicFileUrl, useListing, useSimilarListings, type Listing } from "@/api/listings";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/common/avatar";
import { ListingAmenities, ListingDetails, ListingFacts, ListingLocation, ListingPhoto, ListingsLayout, SimilarCard } from "./listing-parts";

/** Фото: сетка на компьютере, свайп-лента на телефоне, просмотр на весь экран. */
function Gallery({ listing }: { listing: Listing }) {
  const { t } = useTranslation();
  const [full, setFull] = useState<number | null>(null);
  const photos = listing.photos;
  const n = photos.length;

  if (n === 0) {
    return (
      <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-muted/50 text-muted-foreground">
        <ImageOff className="size-10" aria-hidden />
        <p className="text-sm">{t("listing.noPhotos")}</p>
      </div>
    );
  }

  const alt = (i: number) => t("listing.photoAlt", { title: listing.title, n: i + 1 });
  const open = (i: number) => (
    <button
      type="button"
      onClick={() => setFull(i)}
      aria-label={t("listing.openFullscreen")}
      className="block size-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-ring"
    >
      <ListingPhoto src={photos[i]} alt={alt(i)} className="size-full transition duration-300 hover:scale-[1.03]" />
    </button>
  );

  return (
    <div>
      <div className="relative">
        <div className="aspect-[4/3] overflow-hidden bg-muted sm:rounded-2xl md:aspect-[16/9] md:rounded-2xl">{open(0)}</div>
        {n > 1 && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setFull(0)} className="absolute bottom-3 left-3 shadow-md">
            <Images aria-hidden />
            {t("listing.allPhotos", { count: n })}
          </Button>
        )}
      </div>
      <Lightbox urls={photos.map(publicFileUrl)} index={full} onIndexChange={setFull} title={listing.title} />
    </div>
  );
}

/** Прямая связь с владельцем: звонок или сообщение в Telegram по номеру. */
function ContactBlock({ listing }: { listing: Listing }) {
  const { t } = useTranslation();
  const phone = listing.phone;
  if (!phone) return <p className="text-sm text-muted-foreground">{t("listing.contact.none")}</p>;
  const digits = phone.replace(/[^\d+]/g, "");
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("listing.contact.title")}</p>
      <Button asChild size="lg" className="w-full">
        <a href={`tel:${digits}`}>
          <Phone aria-hidden />
          {t("listing.contact.call")}
        </a>
      </Button>
      {listing.has_telegram && (
        <Button asChild size="lg" variant="secondary" className="w-full">
          <a href={`https://t.me/${digits.startsWith("+") ? digits : `+${digits}`}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden />
            {t("listing.contact.write")}
          </a>
        </Button>
      )}
      <p className="text-center text-sm font-medium tabular">{phone}</p>
    </div>
  );
}

/** Липкая панель «Позвонить / Написать» внизу экрана — только на мобильных. */
function MobileContactBar({ listing }: { listing: Listing }) {
  const { t } = useTranslation();
  const phone = listing.phone;
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-border bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur md:hidden">
      <Button asChild size="lg" className="min-w-0 flex-1">
        <a href={`tel:${digits}`}>
          <Phone aria-hidden />
          {t("listing.contact.call")}
        </a>
      </Button>
      {listing.has_telegram && (
        <Button asChild size="lg" variant="secondary" className="min-w-0 flex-1">
          <a href={`https://t.me/${digits.startsWith("+") ? digits : `+${digits}`}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden />
            {t("listing.contact.writeShort")}
          </a>
        </Button>
      )}
    </div>
  );
}

/** Владелец: имя, как давно на сайте, сколько объявлений и ссылка на все. */
function OwnerCard({ listing }: { listing: Listing }) {
  const { t, i18n } = useTranslation();
  if (!listing.owner_name) return null;
  const since = listing.owner_since
    ? new Intl.DateTimeFormat(i18n.language.startsWith("uz") ? "uz" : "ru", { month: "long", year: "numeric" }).format(new Date(listing.owner_since))
    : "";
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <div className="flex items-center gap-3">
        <Avatar name={listing.owner_name} size="lg" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{t("listing.owner")}</p>
          <p className="truncate font-semibold">{listing.owner_name}</p>
          {since && <p className="text-xs text-muted-foreground">{t("listing.ownerSince", { date: since })}</p>}
        </div>
      </div>
      {listing.owner_listings > 1 && (
        <Link to={`/listings?owner=${listing.owner}`} className="mt-3 block text-sm font-medium text-primary hover:underline">
          {t("listing.ownerAll", { count: listing.owner_listings })} →
        </Link>
      )}
    </div>
  );
}

/** Поделиться ссылкой: системное окно на телефоне, иначе копирование. */
function ShareButton({ title }: { title: string }) {
  const { t } = useTranslation();
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success(t("listing.linkCopied"));
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") toast.error(t("listing.shareFailed"));
    }
  };
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => void share()} className="shrink-0">
      <Share2 aria-hidden />
      <span className="hidden sm:inline">{t("listing.share")}</span>
      <span className="sr-only sm:hidden">{t("listing.share")}</span>
    </Button>
  );
}

/** Описание: длинный текст сворачивается. */
function Description({ text }: { text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const long = text.length > 320;
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">{t("listing.about")}</h2>
      <p className={cn("whitespace-pre-line leading-relaxed text-foreground/90", long && !open && "line-clamp-6")}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 text-sm font-medium text-primary hover:underline">
          {open ? t("listing.readLess") : t("listing.readMore")}
        </button>
      )}
    </section>
  );
}

/** Лента похожих объявлений со стрелками. */
function SimilarListings({ id }: { id: number }) {
  const { t } = useTranslation();
  const similar = useSimilarListings(id);
  const track = useRef<HTMLUListElement>(null);
  const items = similar.data ?? [];
  if (items.length === 0) return null;
  const scroll = (dir: number) => track.current?.scrollBy({ left: dir * 300, behavior: "smooth" });
  return (
    <section className="mt-10" aria-labelledby="similar-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="similar-title" className="text-xl font-semibold tracking-tight sm:text-2xl">
          {t("listing.similar")}
        </h2>
        <div className="hidden gap-1 sm:flex">
          <Button size="icon" variant="secondary" onClick={() => scroll(-1)} aria-label={t("listing.prevPhoto")}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button size="icon" variant="secondary" onClick={() => scroll(1)} aria-label={t("listing.nextPhoto")}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
      <ul ref={track} className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
        {items.map((item) => (
          <li key={item.id} className="flex">
            <SimilarCard listing={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ListingPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const id = Number(useParams().id);
  const listing = useListing(id);

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-3 mt-4">
      <Link to="/listings">
        <ArrowLeft aria-hidden />
        {t("listing.back")}
      </Link>
    </Button>
  );

  if (listing.isPending) {
    return (
      <ListingsLayout>
        {back}
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="aspect-[16/10] rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </ListingsLayout>
    );
  }
  if (listing.isError) {
    return (
      <ListingsLayout>
        {back}
        <Card className="mt-4">
          {errorKind(listing.error) === "notFound" ? (
            <EmptyState illustration="lost" title={t("listing.notFound")} description={t("listing.notFoundText")} />
          ) : (
            <ErrorState error={listing.error} onRetry={() => void listing.refetch()} retrying={listing.isRefetching} />
          )}
        </Card>
      </ListingsLayout>
    );
  }

  const l = listing.data;
  const price = t("listing.perMonth", { price: fmt.money(l.price) });
  return (
    <ListingsLayout>
      {back}
      <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Gallery listing={l} />
          <div>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{l.title}</h1>
              <ShareButton title={l.title} />
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="size-4 shrink-0" aria-hidden />
              {l.address}
            </p>
            <p className="mt-3 font-display text-3xl font-bold tabular lg:hidden">{price}</p>
            <ListingFacts listing={l} className="mt-3 text-base" />
          </div>
          <ListingDetails listing={l} />
          <ListingAmenities listing={l} />
          {l.description && <Description text={l.description} />}
          <p className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground tabular">
            <span>{t("listing.id", { id: l.id })}</span>
            <span>{t("listing.published", { date: fmt.date(l.created_at) })}</span>
          </p>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <Card>
            <CardContent className="space-y-4 pt-5">
              <p className="hidden whitespace-nowrap font-display text-2xl font-bold tabular lg:block xl:text-[28px]">{price}</p>
              <OwnerCard listing={l} />
              <div className="hidden md:block">
                <ContactBlock listing={l} />
              </div>
            </CardContent>
          </Card>
          <ListingLocation address={l.address} />
        </aside>
      </div>
      <SimilarListings id={l.id} />
      {l.phone && <div className="h-24 md:hidden" aria-hidden />}
      <MobileContactBar listing={l} />
    </ListingsLayout>
  );
}
