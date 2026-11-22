import type { AdminUser } from "@/api/admin";

export const displayName = (u: AdminUser) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email;
