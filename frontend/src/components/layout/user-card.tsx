import { ChevronsUpDown, Home, KeyRound, LogOut, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/common/avatar";
import { useAuth } from "@/features/auth/auth-context";
import { cn } from "@/lib/utils";
import { useCurrentUser, type UserRole } from "./use-current-user";

const ROLE_VISUAL: Record<UserRole, { icon: LucideIcon; className: string }> = {
  landlord: { icon: KeyRound, className: "bg-accent text-accent-foreground" },
  tenant: { icon: Home, className: "bg-sand-soft text-warning" },
};

/** Значок роли: иконка + текст («Арендодатель» / «Жилец»). */
export function RoleBadge({
  role, adminRole, className,
}: { role: UserRole; adminRole?: "admin" | "support" | null; className?: string }) {
  const { t } = useTranslation();
  const { icon: Icon, className: tone } = adminRole ? { icon: ShieldCheck, className: "bg-primary/15 text-primary" } : ROLE_VISUAL[role];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", tone, className)}>
      <Icon className="size-3" aria-hidden />
      {adminRole ? t(`admin.roles.${adminRole}`) : t(`roles.${role}`)}
    </span>
  );
}

/** Карточка пользователя внизу боковой панели: имя, фамилия, роль; по клику — меню с выходом. */
export function UserCard({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const user = useCurrentUser();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={collapsed ? [user.name, user.role && (user.adminRole ? t(`admin.roles.${user.adminRole}`) : t(`roles.${user.role}`))].filter(Boolean).join(" · ") : undefined}
          aria-label={collapsed ? [user.name, user.role && (user.adminRole ? t(`admin.roles.${user.adminRole}`) : t(`roles.${user.role}`))].filter(Boolean).join(", ") : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted data-[state=open]:bg-muted",
            collapsed && "justify-center p-1.5",
          )}
        >
          {user.isPending && !user.name ? (
            <Skeleton className="size-9 rounded-full" />
          ) : (
            <Avatar name={user.name || "?"} />
          )}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                {user.isPending ? (
                  <Skeleton className="h-4 w-28" />
                ) : (
                  <span className="block truncate text-sm font-semibold">{user.name}</span>
                )}
                {user.role && <RoleBadge role={user.role} adminRole={user.adminRole} className="mt-1" />}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={collapsed ? "right" : "top"} align={collapsed ? "end" : "start"} className="w-56">
        <DropdownMenuLabel className="space-y-0.5">
          <span className="block truncate text-sm font-semibold text-foreground">{user.name}</span>
          {user.email && user.email !== user.name && <span className="block truncate font-normal">{user.email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.role === "landlord" && (
          <DropdownMenuItem asChild>
            <Link to={user.isAdmin ? "/admin/profile" : "/profile"}>
              <UserRound aria-hidden />
              {t("nav.profile")}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={signOut}>
          <LogOut aria-hidden />
          {t("auth.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
