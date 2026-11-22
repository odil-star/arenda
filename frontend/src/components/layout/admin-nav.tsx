import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAdminSupportUnread, useMyPresence } from "@/api/support";
import { cn } from "@/lib/utils";
import { ADMIN_PRIMARY_AREAS, adminTabHref, type AdminAreaView } from "./nav-items";
import { useAdminNav } from "./use-admin-nav";

function Badge({ count, dot }: { count: number; dot?: boolean }) {
  if (count <= 0) return null;
  return dot ? (
    <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-danger" aria-hidden />
  ) : (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold tabular-nums text-white dark:text-background" aria-hidden>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function useBadges() {
  const unread = useAdminSupportUnread().data ?? 0;
  useMyPresence(); // отметка «я здесь» раз в минуту, пока открыта любая страница админки
  return (area: AdminAreaView) => (area.id === "support" ? unread : 0);
}

/** Зелёная точка у «Поддержки», когда я в сети. */
function PresenceDot() {
  const online = useMyPresence().data?.status === "online";
  if (!online) return null;
  return <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-card bg-success" aria-hidden />;
}

/** Компьютер: все разделы админки отдельными пунктами, сгруппированы по смыслу. */
export function AdminSidebarNav({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const { areas, area: current, onAdmin } = useAdminNav();
  const badge = useBadges();
  const groups = Array.from(new Set(areas.map((a) => a.group)));
  return (
    <div className="space-y-1">
      {groups.map((group, gi) => (
        <section key={group} aria-label={t(`admin.groups.${group}`)}>
          {gi > 0 &&
            (collapsed ? (
              <div className="mx-2 my-3 h-px bg-border" aria-hidden />
            ) : (
              <p className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {t(`admin.groups.${group}`)}
              </p>
            ))}
          <ul className="space-y-0.5">
            {areas
              .filter((a) => a.group === group)
              .map((area) => {
                const Icon = area.icon;
                const active = onAdmin && area.id === current.id;
                const count = badge(area);
                return (
                  <li key={area.id}>
                    <Link
                      to={adminTabHref(area.id)}
                      title={collapsed ? t(`admin.areas.${area.id}`) : undefined}
                      aria-current={active ? "page" : undefined}
                      aria-label={count ? `${t(`admin.areas.${area.id}`)} (${count})` : undefined}
                      className={cn(
                        "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                        active &&
                          "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground before:absolute before:-left-3 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-primary before:shadow-[0_0_10px_var(--glow)]",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      <span className="relative shrink-0">
                        <Icon className="size-[18px]" aria-hidden />
                        {area.id === "support" && <PresenceDot />}
                      </span>
                      <span className={cn("truncate", collapsed && "sr-only")}>{t(`admin.areas.${area.id}`)}</span>
                      <Badge count={count} dot={collapsed} />
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Телефон и планшет: 4 главных раздела + «Ещё» со шторкой остальных. */
export function AdminBottomNav() {
  const { t } = useTranslation();
  const { areas, area: current, onAdmin } = useAdminNav();
  const badge = useBadges();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = areas.filter((a) => ADMIN_PRIMARY_AREAS.includes(a.id));
  const rest = areas.filter((a) => !ADMIN_PRIMARY_AREAS.includes(a.id));
  const restActive = onAdmin && rest.some((a) => a.id === current.id);

  const item = "relative flex h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium leading-none transition-colors";

  return (
    <>
      <nav aria-label={t("nav.main")} className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <ul
          className="liquid-glass pointer-events-auto mx-auto grid max-w-lg items-center gap-0.5 rounded-2xl p-1 "
          style={{ gridTemplateColumns: `repeat(${primary.length + (rest.length ? 1 : 0)}, minmax(0, 1fr))` }}
        >
          {primary.map((area) => {
            const Icon = area.icon;
            const active = onAdmin && area.id === current.id;
            return (
              <li key={area.id}>
                <Link
                  to={adminTabHref(area.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(item, active ? "bg-foreground/10 text-foreground" : "text-muted-foreground active:bg-foreground/5")}
                >
                  <Icon className="size-5" aria-hidden />
                  <span className="max-w-full truncate">{t(`admin.areasShort.${area.id}`)}</span>
                  <Badge count={badge(area)} dot />
                </Link>
              </li>
            );
          })}
          {rest.length > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                className={cn(item, "w-full", restActive ? "bg-foreground/10 text-foreground" : "text-muted-foreground active:bg-foreground/5")}
              >
                <Ellipsis className="size-5" aria-hidden />
                <span className="max-w-full truncate">{restActive ? t(`admin.areasShort.${current.id}`) : t("admin.more")}</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        {moreOpen && (
          <DialogContent title={t("admin.moreTitle")}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {rest.map((area) => {
                const Icon = area.icon;
                const active = onAdmin && area.id === current.id;
                return (
                  <li key={area.id}>
                    <Link
                      to={adminTabHref(area.id)}
                      onClick={() => setMoreOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-16 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                        active ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-muted",
                      )}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                        <Icon className="size-[18px]" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{t(`admin.areas.${area.id}`)}</span>
                        <span className="block text-xs text-muted-foreground">{t(`admin.areaHints.${area.id}`)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

/** Вкладки внутри раздела (например, «Жильцы · Договоры · Оплаты»). Скрыты, если вкладка одна. */
export function AdminSubNav() {
  const { t } = useTranslation();
  const { area, tab } = useAdminNav();
  if (area.tabs.length < 2) return null;
  return (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" aria-label={t(`admin.areas.${area.id}`)} className="inline-flex gap-1 rounded-xl bg-muted p-1">
        {area.tabs.map((id) => {
          const active = id === tab;
          return (
            <Link
              key={id}
              to={adminTabHref(id)}
              role="tab"
              aria-selected={active}
              className={cn(
                "flex min-h-9 items-center whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors",
                active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`admin.tabs.${id}`)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
