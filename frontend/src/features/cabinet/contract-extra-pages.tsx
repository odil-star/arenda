import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenantLeases } from "@/api/portal";
import { TenantMediaSection } from "@/features/media/tenant-media";

function Frame({ leaseId, title, subtitle, children }: { leaseId: string | undefined; title: string; subtitle?: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-5 px-4 pb-12">
      <header className="flex h-14 items-center">
        <Button variant="ghost" size="icon" asChild aria-label={t("common.back")}>
          <Link to={`/cabinet/contracts/${leaseId}`} replace>
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
      </header>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Фото и видео квартиры: нажатие на плитку открывает просмотр. */
export function MediaCabinetPage() {
  const { t } = useTranslation();
  const { leaseId } = useParams();
  const leases = useTenantLeases();
  const lease = leases.data?.find((l) => String(l.id) === leaseId);

  return (
    <Frame leaseId={leaseId} title={t("cabinet.media")} subtitle={lease?.property_name}>
      {lease ? <TenantMediaSection leaseId={lease.id} /> : <Skeleton className="h-40 w-full" />}
    </Frame>
  );
}
