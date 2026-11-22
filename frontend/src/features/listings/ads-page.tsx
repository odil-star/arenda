import { ExternalLink, EyeOff, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { serverMessages } from "@/api/errors";
import { propertiesApi, useOccupiedPropertyIds } from "@/api/hooks";
import type { Property } from "@/api/types";
import { useFormat } from "@/lib/format";

/** Раздел арендодателя «Объявления»: что опубликовано в поиске квартир и как выставить новое. */
export function AdsPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [page, setPage] = useState(1);
  const query = propertiesApi.useList({ page, page_size: 20 });
  const occupied = useOccupiedPropertyIds();
  const update = propertiesApi.useUpdate();

  const unpublish = async (p: Property) => {
    try {
      await update.mutateAsync({
        id: p.id,
        input: {
          name: p.name, address: p.address, kind: p.kind, area_m2: p.area_m2, is_under_repair: p.is_under_repair,
          notes: p.notes, rooms: p.rooms, contact_phone: p.contact_phone, has_telegram: p.has_telegram, listing_price: p.listing_price, listing_description: p.listing_description,
          is_listed: false,
        },
      });
      toast.success(t("ads.unpublished"));
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
    }
  };

  const state = (p: Property) => {
    if (!p.is_listed) return { tone: "neutral" as const, label: t("ads.state.off") };
    if (p.is_under_repair) return { tone: "warning" as const, label: t("ads.state.repair") };
    if (occupied.ids.has(p.id)) return { tone: "warning" as const, label: t("ads.state.occupied") };
    return { tone: "success" as const, label: t("ads.state.live") };
  };

  const create = (
    <Button asChild>
      <Link to="/ads/new">
        <Plus aria-hidden />
        {t("ads.create")}
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t("ads.title")}
        description={t("ads.description")}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to="/listings" target="_blank" rel="noopener">
                <ExternalLink aria-hidden />
                {t("ads.openSearch")}
              </Link>
            </Button>
            {create}
          </>
        }
      />
      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : query.data.results.length === 0 ? (
        <Card>
          <EmptyState illustration="home" title={t("ads.emptyTitle")} description={t("ads.emptyText")} action={create} />
        </Card>
      ) : (
        <>
          <Card>
            <ul className="divide-y divide-border">
              {query.data.results.map((p) => {
                const s = state(p);
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
                    <div className="min-w-0 flex-1 basis-48">
                      <Link to={`/properties/${p.id}`} className="block truncate font-medium hover:underline">{p.name}</Link>
                      <p className="truncate text-sm text-muted-foreground">{p.address}</p>
                    </div>
                    <p className="text-sm font-semibold tabular sm:w-40">
                      {p.listing_price ? t("listing.perMonth", { price: fmt.money(p.listing_price) }) : "—"}
                    </p>
                    <Badge tone={s.tone}>{s.label}</Badge>
                    <div className="flex gap-2">
                      <Button asChild size="sm" variant={p.is_listed ? "secondary" : "primary"}>
                        <Link to={`/ads/${p.id}`}>
                          <Pencil aria-hidden />
                          {p.is_listed ? t("listing.edit") : t("listing.publish")}
                        </Link>
                      </Button>
                      {p.is_listed && (
                        <Button size="sm" variant="ghost" onClick={() => void unpublish(p)} loading={update.isPending && update.variables?.id === p.id}>
                          <EyeOff aria-hidden />
                          {t("ads.unpublish")}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <div className="mt-4">
            <Pagination page={page} pageSize={20} count={query.data.count} onPageChange={setPage} />
          </div>
        </>
      )}
    </>
  );
}
