import type { ComponentType } from "react";
import { HomeIcon, BuildingIcon, WalletIcon, PeopleIcon, type TabIconProps } from "./nav-icons";
import {
  Activity, Building2, ClipboardList, Globe, CreditCard, FileText, Headset, LayoutDashboard, Megaphone, Receipt, ScrollText, Send, ShieldCheck, UserRound,
  Users, Wallet, Webhook, type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  labelKey: "nav.dashboard" | "nav.properties" | "nav.tenants" | "nav.leases" | "nav.payments" | "nav.receipts" | "nav.admin" | "nav.profile" | "nav.support" | "nav.ads" | "nav.requests";
  icon: LucideIcon;
  /** контурная/залитая иконка для нижней навигации */
  tabIcon?: ComponentType<TabIconProps>;
  end?: boolean;
}

/*
 * Структура вокруг объекта: объект → кто живёт → платежи.
 * Договоры — второстепенный раздел: обычно до них доходят со страницы объекта.
 */
export const NAV_PRIMARY: readonly NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, tabIcon: HomeIcon, end: true },
  { to: "/properties", labelKey: "nav.properties", icon: Building2, tabIcon: BuildingIcon },
  { to: "/payments", labelKey: "nav.payments", icon: Wallet, tabIcon: WalletIcon },
  { to: "/tenants", labelKey: "nav.tenants", icon: Users, tabIcon: PeopleIcon },
];

export const NAV_SECONDARY: readonly NavItem[] = [
  { to: "/ads", labelKey: "nav.ads", icon: Globe },
  { to: "/leases", labelKey: "nav.leases", icon: FileText },
  { to: "/requests", labelKey: "nav.requests", icon: ClipboardList },
  { to: "/receipts", labelKey: "nav.receipts", icon: Receipt },
  { to: "/support", labelKey: "nav.support", icon: Headset },
];

/** Разделы админа: вкладки страницы /admin, вынесенные в боковое меню. */
export const ADMIN_SECTIONS = [
  { tab: "overview", icon: LayoutDashboard, group: "overview" },
  { tab: "support", icon: Headset, group: "overview" },
  { tab: "landlords", icon: Users, group: "data" },
  { tab: "tenants", icon: UserRound, group: "data" },
  { tab: "leases", icon: FileText, group: "data" },
  { tab: "payments", icon: Wallet, group: "data" },
  { tab: "plans", icon: CreditCard, group: "data" },
  { tab: "system", icon: Activity, group: "system" },
  { tab: "webhooks", icon: Webhook, group: "system" },
  { tab: "audit", icon: ScrollText, group: "system" },
  { tab: "announcements", icon: Megaphone, group: "system" },
  { tab: "messages", icon: Send, group: "system", superOnly: true },
  { tab: "admins", icon: ShieldCheck, group: "system", superOnly: true },
  { tab: "profile", icon: UserRound, group: "account" },
] as const;

/** Разделы, недоступные роли «поддержка» (только просмотр). */
export const ADMIN_SUPER_ONLY: readonly string[] = ADMIN_SECTIONS.filter((s) => "superOnly" in s).map((s) => s.tab);

export type AdminTab = (typeof ADMIN_SECTIONS)[number]["tab"];

/*
 * Каждый раздел админки — отдельная страница со своим путём: /admin, /admin/landlords, /admin/payments и т. д.
 * Старые ссылки вида /admin?tab=payments&problem=1 перенаправляются на новые (см. AdminPage).
 */
export const ADMIN_AREAS = ADMIN_SECTIONS.map((s) => ({
  id: s.tab,
  icon: s.icon,
  group: s.group,
  tabs: [s.tab] as readonly AdminTab[],
}));

export type AdminAreaId = AdminTab;

export interface AdminAreaView {
  id: AdminAreaId;
  icon: LucideIcon;
  group: AdminGroup;
  tabs: readonly AdminTab[];
}

/** На телефоне и планшете — в нижней панели; остальные разделы — в «Ещё». */
export const ADMIN_PRIMARY_AREAS: readonly AdminAreaId[] = ["overview", "support", "landlords", "payments"];

/** Разделы, доступные роли: «поддержка» не видит закрытых разделов. */
export function adminAreasFor(role: "admin" | "support" | null | undefined): AdminAreaView[] {
  return ADMIN_AREAS.filter((a) => role !== "support" || !ADMIN_SUPER_ONLY.includes(a.id));
}

/** Ссылка на вкладку админки. */
export const adminTabHref = (tab: AdminTab) => (tab === "overview" ? "/admin" : `/admin/${tab}`);
export type AdminGroup = (typeof ADMIN_SECTIONS)[number]["group"];

/** Только для суперпользователя (см. useCurrentUser().isAdmin). */
export const NAV_ADMIN: NavItem = { to: "/admin", labelKey: "nav.admin", icon: ShieldCheck };
