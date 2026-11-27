import { useMe } from "@/api/hooks";
import { useRole, useTenantMe, type Role } from "@/api/portal";
import { useAuth } from "@/features/auth/auth-context";

export type UserRole = Role;

function joinName(first?: string, last?: string): string {
  return [first, last].map((s) => s?.trim()).filter(Boolean).join(" ");
}

/**
 * Текущий пользователь для карточки и меню аккаунта.
 * Роль — из useRole (/api/me/ доступен только арендодателю, 403 = жилец),
 * профиль — из /api/me/ для арендодателя или /api/tenant/me/ для жильца.
 * Сейчас используется в оболочке арендодателя, но подходит и для кабинета жильца.
 */
export function useCurrentUser() {
  const { username } = useAuth();
  const roleQuery = useRole();
  const role = roleQuery.data;
  const landlord = useMe(role === "landlord");
  const tenant = useTenantMe(role === "tenant");

  const profile = role === "tenant" ? tenant.data : landlord.data;
  const email = profile?.email ?? username ?? "";
  const profilePending = role === "tenant" ? tenant.isPending : landlord.isPending;

  return {
    /** «Имя Фамилия», а если имени нет — email или телефон */
    name: joinName(profile?.first_name, profile?.last_name) || email || profile?.phone || "",
    email,
    /** undefined, пока роль не определена */
    role,
    isAdmin: role === "landlord" && landlord.data?.is_admin === true,
    /** Помощник владельца (бухгалтер/управляющий): урезанное меню и профиль */
    isAssistant: role === "landlord" && !!landlord.data?.assistant,
    assistantRole: landlord.data?.assistant?.role ?? null,
    /** Роль сотрудника платформы: admin — всё, support — только просмотр */
    adminRole: landlord.data?.admin_role ?? null,
    isPending: roleQuery.isPending || profilePending,
  };
}
