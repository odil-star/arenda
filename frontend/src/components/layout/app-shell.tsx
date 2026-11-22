import { ChevronLeft, Headset, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSupportUnread } from "@/api/support";
import { cn } from "@/lib/utils";

const buttonClass =
  "inline-flex items-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
import { Brand } from "./brand";
import { AnnouncementBanner } from "./announcement-banner";
import { ImpersonationBanner } from "./impersonation-banner";
import { AdminBottomNav, AdminSidebarNav } from "./admin-nav";
import { NAV_PRIMARY, NAV_SECONDARY, type NavItem } from "./nav-items";
import { GlassIndicator } from "./glass-indicator";
import { useGlassDrag } from "./use-glass-drag";
import { QuickActionsButton } from "./quick-actions";
import { LanguageSwitcher, ThemeSwitcher, UserMenu } from "./preferences";
import { UserCard } from "./user-card";
import { useCurrentUser } from "./use-current-user";

const COLLAPSED_KEY = "sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function CountBadge({ count, dot }: { count: number; dot?: boolean }) {
  if (count <= 0) return null;
  return dot ? (
    <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-danger" aria-hidden />
  ) : (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white tabular-nums dark:text-background" aria-hidden>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function SidebarLink({ item, collapsed, badge = 0 }: { item: NavItem; collapsed: boolean; badge?: number }) {
  const { t } = useTranslation();
  const { to, labelKey, icon: Icon, end } = item;
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? t(labelKey) : undefined}
      aria-label={badge > 0 ? `${t(labelKey)} (${t("support.unreadCount", { count: badge })})` : undefined}
      className={({ isActive }) =>
        cn(
          "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          isActive &&
            "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground before:absolute before:-left-3 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-primary before:shadow-[0_0_10px_var(--glow)]",
          collapsed && "justify-center px-0",
        )
      }
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      <span className={cn(collapsed && "sr-only")}>{t(labelKey)}</span>
      <CountBadge count={badge} dot={collapsed} />
    </NavLink>
  );
}

function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { isAdmin, role, isPending } = useCurrentUser();
  const supportUnread = useSupportUnread(!isPending && role === "landlord" && !isAdmin).data ?? 0; // только когда профиль загружен и это точно не админ

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        /* без сохранения */
      }
      return !c;
    });
  };

  return (
    <aside
      className={cn(
        "group/sidebar sticky top-0 z-40 hidden h-dvh shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 lg:flex",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      <div className={cn("relative flex h-14 items-center px-4", collapsed && "justify-center px-0")}>
        <Brand compact={collapsed} />
        {/* «язычок» на правой границе панели: свернуть / развернуть */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
          className={cn(
            "absolute -right-3.5 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors",
            "hover:border-input hover:bg-accent hover:text-accent-foreground",
            // расширяем зону нажатия, не увеличивая сам кружок
            "before:absolute before:-inset-2 before:content-['']",
          )}
        >
          <ChevronLeft strokeWidth={2.75} className={cn("size-4 -translate-x-px transition-transform duration-200", collapsed && "translate-x-px rotate-180")} aria-hidden />
        </button>
      </div>
      {!isAdmin && (
      <div className="px-3 pb-2 pt-1">
        <Link
          to="/leases/new"
          title={collapsed ? t("quick.newLease") : undefined}
          aria-label={collapsed ? t("quick.newLease") : undefined}
          className={cn(
            buttonClass,
            "h-10 w-full justify-start gap-2.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-[0_4px_18px_var(--glow)] hover:bg-primary/90",
            collapsed && "justify-center px-0",
          )}
        >
          <Plus className="size-[18px] shrink-0" strokeWidth={2.5} aria-hidden />
          <span className={cn(collapsed && "sr-only")}>{t("quick.newLease")}</span>
        </Link>
      </div>
      )}
      <nav aria-label={t("nav.main")} className="flex-1 overflow-y-auto px-3 py-2">
        {isAdmin ? (
          <AdminSidebarNav collapsed={collapsed} />
        ) : (
          <>
            <ul className="space-y-0.5">
              {NAV_PRIMARY.map((item) => (
                <li key={item.to}>
                  <SidebarLink item={item} collapsed={collapsed} />
                </li>
              ))}
            </ul>
            <p className={cn("mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70", collapsed && "sr-only")}>
              {t("nav.more")}
            </p>
            {collapsed && <div className="mx-2 my-3 h-px bg-border" aria-hidden />}
            <ul className="space-y-0.5">
              {NAV_SECONDARY.map((item) => (
                <li key={item.to}>
                  <SidebarLink item={item} collapsed={collapsed} badge={item.to === "/support" ? supportUnread : 0} />
                </li>
              ))}
            </ul>
          </>
        )}
      </nav>
      <div className="border-t border-border p-3">
        <UserCard collapsed={collapsed} />
      </div>
    </aside>
  );
}

function BottomTab({ item, active }: { item: NavItem; active: boolean }) {
  const { t } = useTranslation();
  const { to, labelKey, icon, tabIcon, end } = item;
  const Icon = tabIcon ?? icon;
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={t(labelKey)}
      draggable={false}
      className={cn("flex h-12 items-center justify-center text-muted-foreground transition-transform active:scale-90", active && "text-foreground")}
    >
      <Icon
        className={cn("size-[26px] transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none", active && "scale-110")}
        solid={active}
        aria-hidden
      />
    </NavLink>
  );
}

/** Телефон: плавающая стеклянная капсула; «+» стоит в центре и чуть выступает вверх. Можно зажать и провести пальцем. */
function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // сетка из 5 колонок: вкладка, вкладка, «+» (индекс 2), вкладка, вкладка
  const slots: (NavItem | null)[] = [NAV_PRIMARY[0], NAV_PRIMARY[1], null, NAV_PRIMARY[2], NAV_PRIMARY[3]];
  const current = slots.findIndex((i) => i && (i.end ? pathname === i.to : pathname === i.to || pathname.startsWith(i.to + "/")));
  const drag = useGlassDrag(5, (i) => {
    const item = slots[i];
    if (item && i !== current) navigate(item.to);
  });
  const shown = drag.hover ?? current;
  return (
    <nav aria-label={t("nav.main")} className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <ul
        ref={drag.ref}
        {...drag.handlers}
        style={{ touchAction: "none" }}
        className="liquid-glass pointer-events-auto relative mx-auto grid max-w-md select-none grid-cols-5 items-center rounded-full p-1.5"
      >
        <GlassIndicator index={drag.pos ?? current} count={5} dragging={drag.pos !== null} />
        {slots.map((item, i) => (
          <li key={item?.to ?? "quick"} className={cn("relative", !item && "flex items-center justify-center")}>
            {item ? <BottomTab item={item} active={shown === i} /> : <QuickActionsButton />}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SupportButton() {
  const { t } = useTranslation();
  const { isAdmin, role, isPending } = useCurrentUser();
  const unread = useSupportUnread(!isPending && role === "landlord" && !isAdmin).data ?? 0; // только когда профиль загружен и это точно не админ
  if (role !== "landlord" || isAdmin) return null;
  return (
    <Link
      to="/support"
      aria-label={unread > 0 ? `${t("nav.support")} (${t("support.unreadCount", { count: unread })})` : t("nav.support")}
      className="relative flex size-11 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
    >
      <Headset className="size-5" aria-hidden />
      <CountBadge count={unread} dot />
    </Link>
  );
}

function TopBar() {
  return (
    <header className="flex h-14 items-center justify-between gap-2 border-b border-border bg-background/90 px-4 backdrop-blur sm:px-6 lg:justify-end">
      <Brand className="lg:hidden" />
      <div className="flex items-center gap-0.5">
        <SupportButton />
        <LanguageSwitcher />
        <ThemeSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}

/** Страницы, которые занимают всю рабочую область без полей: чат арендодателя и чат в админке. */
function useFullBleed() {
  const { pathname } = useLocation();
  return pathname === "/support" || pathname === "/admin/support";
}

export function AppShell() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { isAdmin } = useCurrentUser();
  const fullBleed = useFullBleed();
  return (
    <div className={cn("flex", fullBleed ? "h-dvh overflow-hidden" : "min-h-dvh")}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {t("nav.skipToContent")}
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30">
          <ImpersonationBanner />
          <TopBar />
        </div>
        {fullBleed ? (
          // чат: без полей, без ограничения ширины и без баннеров — всё место под переписку
          <main id="main" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col outline-none">
            <Outlet />
          </main>
        ) : (
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 pb-32 pt-5 outline-none sm:px-6 sm:pt-6 lg:pb-10">
            <AnnouncementBanner className="mb-4" />
            {/* ключ по пути — мягкое появление при переходе между разделами (фильтры в query не дёргают анимацию) */}
            <div key={pathname} className="animate-rise-in">
              <Outlet />
            </div>
          </main>
        )}
      </div>
      {/* в чате нижнее меню не нужно: оно закрывало бы поле ввода */}
      {!fullBleed && (isAdmin ? <AdminBottomNav /> : <BottomNav />)}
    </div>
  );
}
