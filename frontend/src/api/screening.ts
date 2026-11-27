import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export type Verdict = "reliable" | "mostly" | "risky" | "not_enough";

/** VIP: обезличенная платёжная репутация жильца. Данные других арендодателей наружу не отдаются, только счётчики. */
export type Screening =
  | { status: "not_linked" | "not_shared" }
  | {
      status: "ok";
      verdict: Verdict;
      payments: number;
      on_time: number;
      late: number;
      overdue: number;
      leases: number;
      landlords: number;
      months: number;
      grace_days: number;
    };

/** Проверка запускается только по кнопке (enabled): каждый запрос попадает в журнал действий. */
export function useTenantScreening(tenantId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["screening", tenantId],
    enabled: enabled && tenantId !== undefined,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => (await api.get<Screening>(`/tenants/${tenantId}/screening/`, { signal })).data,
  });
}
