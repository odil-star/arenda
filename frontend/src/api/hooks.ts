import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "./client";
import { createResource } from "./resource";
import type {
  Credentials,
  Dashboard,
  Lease,
  LeaseInput,
  LeaseListParams,
  LinkCode,
  PropertyInvite,
  Me,
  PayInput,
  Payment,
  PaymentListParams,
  Property,
  PropertyInput,
  PropertyListParams,
  RegisterInput,
  Tenant,
  TenantInput,
  TenantListParams,
  TokenPair,
} from "./types";

export const queryKeys = {
  dashboard: ["dashboard"] as const,
};

// ---------- Ресурсы ----------
export const propertiesApi = createResource<Property, PropertyInput, PropertyListParams>({
  key: "properties",
  path: "/properties/",
  invalidates: ["dashboard"],
});

export const tenantsApi = createResource<Tenant, TenantInput, TenantListParams>({
  key: "tenants",
  path: "/tenants/",
});

export const leasesApi = createResource<Lease, LeaseInput, LeaseListParams>({
  key: "leases",
  path: "/leases/",
  // договор меняет занятость объекта, график платежей и цифры дашборда
  invalidates: ["properties", "payments", "dashboard"],
});

export const paymentsApi = createResource<Payment, never, PaymentListParams>({
  key: "payments",
  path: "/payments/",
});

// ---------- Auth ----------
export function useLogin() {
  return useMutation({
    mutationFn: async (input: Credentials) =>
      (await api.post<TokenPair>("/auth/token/", input)).data,
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: async (input: RegisterInput) => {
      await api.post("/auth/register/", input);
      const credentials: Credentials = { email: input.email, password: input.password };
      return (await api.post<TokenPair>("/auth/token/", credentials)).data;
    },
  });
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async ({ signal }) => (await api.get<Me>("/me/", { signal })).data,
    staleTime: 5 * 60_000,
  });
}

export type MeInput = Partial<Pick<Me, "first_name" | "last_name" | "phone" | "passport_data" | "language">>;

/** Профиль арендодателя/админа: сохранить личные данные. */
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MeInput) => (await api.patch<Me>("/me/", input)).data,
    onSuccess: (data) => qc.setQueryData(["me"], data),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: { current_password: string; new_password: string }) => {
      await api.post("/me/password/", input);
    },
  });
}

/** Привязка Telegram владельца: получить одноразовый код. */
export function useOwnerTelegramCode() {
  return useMutation({
    mutationFn: async () => (await api.post<LinkCode>("/me/telegram-link/")).data,
  });
}

export function useOwnerTelegramUnlink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.delete("/me/telegram-link/");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

// ---------- Dashboard ----------
export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: async ({ signal }) => (await api.get<Dashboard>("/dashboard/", { signal })).data,
  });
}

/**
 * API объектов не отдаёт занятость, поэтому считаем её по действующим договорам:
 * объект занят, если на него есть договор со статусом active.
 */
export function useOccupiedPropertyIds() {
  const query = leasesApi.useList({ status: "active", page_size: 100 });
  const ids = useMemo(() => new Set((query.data?.results ?? []).map((l) => l.property)), [query.data]);
  /** объект → действующий договор (кто живёт) */
  const byProperty = useMemo(
    () => new Map((query.data?.results ?? []).map((l) => [l.property, l] as const)),
    [query.data],
  );
  /** арендатор → действующий договор (где живёт) */
  const byTenant = useMemo(
    () => new Map((query.data?.results ?? []).map((l) => [l.tenant, l] as const)),
    [query.data],
  );
  return { ids, byProperty, byTenant, isPending: query.isPending };
}

export function usePropertyInvite() {
  return useMutation({
    mutationFn: async (propertyId: number) =>
      (await api.post<PropertyInvite>(`/properties/${propertyId}/invite/`)).data,
  });
}

/** SVG-QR той же ссылки; запрашивается с JWT, поэтому приходит как data-URL, а не <img src=api>. */
export function useInviteQr(propertyId: number, url: string | undefined) {
  return useQuery({
    queryKey: ["invite-qr", propertyId, url],
    enabled: Boolean(url),
    staleTime: Infinity,
    queryFn: async () => {
      const token = (url ?? "").split("/").pop() ?? "";
      const { data } = await api.get<string>(`/properties/${propertyId}/invite/qr/`, {
        params: { token },
        responseType: "text",
        transformResponse: (r: string) => r,
      });
      return `data:image/svg+xml;utf8,${encodeURIComponent(data)}`;
    },
  });
}

export function useTenantLinkCode() {
  return useMutation({
    mutationFn: async (tenantId: number) => (await api.post<LinkCode>(`/tenants/${tenantId}/link-code/`)).data,
  });
}

// ---------- Действия ----------
/** Реквизиты оплаты договора можно менять в любой момент (PATCH). */
export function useUpdateLeaseDetails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payment_details }: { id: number; payment_details: string }) =>
      (await api.patch<Lease>(`/leases/${id}/`, { payment_details })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leases"] }),
  });
}

/** Что входит в аренду — меняется в любой момент (PATCH). */
export function useUpdateLeaseInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, inventory }: { id: number; inventory: string }) =>
      (await api.patch<Lease>(`/leases/${id}/`, { inventory })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leases"] });
      void qc.invalidateQueries({ queryKey: ["tenant", "leases"] });
    },
  });
}

export function useEndLease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.post<Lease>(`/leases/${id}/end/`)).data,
    onSuccess: () =>
      Promise.all(
        ["leases", "properties", "payments", "dashboard"].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      ),
  });
}

export function usePayPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: PayInput }) =>
      (await api.post<Payment>(`/payments/${id}/pay/`, input)).data,
    onSuccess: () =>
      Promise.all(
        ["payments", "dashboard", "leases"].map((k) => qc.invalidateQueries({ queryKey: [k] })),
      ),
  });
}
