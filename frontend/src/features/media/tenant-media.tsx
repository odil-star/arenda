import { Bell } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useMarkNotificationsRead, useTenantMedia, useTenantNotifications, type LeaseMedia, type TenantNotification } from "@/api/portal";
import { MediaGrid } from "./media-parts";

const fileUrl = (m: LeaseMedia) => `/tenant/media/${m.id}/file/`;

function targetFor(n: TenantNotification) {
  if (n.kind === "repair_updated") return `/cabinet?tab=services&lease=${n.lease}`;
  if (n.kind === "request_resolved") return `/cabinet?tab=contract&lease=${n.lease}`;
  return `/cabinet/contracts/${n.lease}/media`;
}

/** Уведомления о новых и изменённых фото/видео. Нажатие ведёт к материалам дома. */
export function MediaNotifications() {
  const { t } = useTranslation();
  const notes = useTenantNotifications();
  const { mutate: markRead } = useMarkNotificationsRead();
  const unread = (notes.data ?? []).filter((n) => !n.is_read && n.lease !== null);
  if (unread.length === 0) return null;
  return (
    <ul className="space-y-2" aria-live="polite">
      {unread.map((n) => (
        <li key={n.id}>
          <Link
            to={targetFor(n)}
            // фото помечаются прочитанными на странице медиа, остальные — сразу при переходе
            onClick={() => n.kind.startsWith("media") || markRead()}
            className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Bell className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t(`cabinet.notify.${n.kind}`, { count: n.count })}</span>
              <span className="block truncate text-muted-foreground">{n.property_name}</span>
            </span>
            <span className="shrink-0 font-medium text-primary">{t("cabinet.notify.view")}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Фото и видео квартиры на странице дома. Открытие страницы отмечает уведомления прочитанными. */
export function TenantMediaSection({ leaseId }: { leaseId: number }) {
  const { t } = useTranslation();
  const media = useTenantMedia(leaseId);
  const notes = useTenantNotifications();
  const { mutate: markRead, isPending: marking } = useMarkNotificationsRead();
  const hasUnread = (notes.data ?? []).some((n) => !n.is_read && n.lease === leaseId);

  useEffect(() => {
    if (hasUnread && !marking) markRead();
  }, [hasUnread, marking, markRead]);

  if (!media.data?.length) return null;
  return (
    <section aria-labelledby="house-media" className="space-y-3">
      <h2 id="house-media" className="text-[15px] font-semibold">{t("cabinet.media")}</h2>
      <MediaGrid items={media.data} fileUrl={fileUrl} />
    </section>
  );
}
