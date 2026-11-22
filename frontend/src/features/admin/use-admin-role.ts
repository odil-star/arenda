import { useCurrentUser } from "@/components/layout/use-current-user";

/** Роль «поддержка» только смотрит; менять данные может полный администратор. */
export function useAdminRole() {
  const { adminRole } = useCurrentUser();
  return { adminRole, canWrite: adminRole === "admin" };
}
