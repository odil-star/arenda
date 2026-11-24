import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ListingsMap, type MapPoint } from "@/components/common/maps";
import type { Listing } from "@/api/listings";
import { useFormat } from "@/lib/format";

/** Вид «Карта»: подгружается лениво, чтобы Leaflet не попадал в основной бандл. */
export default function ListingsMapView({ listings }: { listings: Listing[] }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const points = useMemo<MapPoint[]>(
    () =>
      listings
        .filter((l) => l.latitude && l.longitude)
        .map((l) => ({
          id: l.id,
          lat: Number(l.latitude),
          lng: Number(l.longitude),
          label: fmt.compact(l.price),
          title: l.title,
          address: l.address,
          price: `${fmt.money(l.price)} ${t("listing.perMonthShort")}`,
          href: `/listings/${l.id}`,
        })),
    [listings, fmt, t],
  );
  const hidden = listings.length - points.length;
  return (
    <div className="space-y-2">
      {points.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-14 text-center text-sm text-muted-foreground">
          {t("listing.map.empty")}
        </p>
      ) : (
        <ListingsMap points={points} className="z-0 h-[60dvh] min-h-[360px] w-full overflow-hidden rounded-2xl border border-border" />
      )}
      {hidden > 0 && points.length > 0 && <p className="text-xs text-muted-foreground">{t("listing.map.noPoints", { count: hidden })}</p>}
    </div>
  );
}
