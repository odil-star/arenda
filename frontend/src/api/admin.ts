import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, cleanParams } from "./client";
import { createResource } from "./resource";
import type { ISODateTime, Money } from "./types";

export interface AdminStats {
  landlords: number;
  landlords_blocked: number;
  landlords_new_30d: number;
  tenants: number;
  properties: number;
  active_leases: number;
  month_payments_count: number;
  month_payments_sum: Money;
  month_online_count: number;
  month_online_sum: Money;
  problem_payments: number;
  overdue_count: number;
  overdue_sum: Money;
}

export interface AdminDailyPoint {
  date: string;
  new_landlords: number;
  payments_count: number;
  payments_sum: Money;
  online_sum: Money;
}

export interface AdminTenant {
  id: number;
  full_name: string;
  phone: string;
  owner: number;
  owner_email: string;
  leases_count: number;
  has_account: boolean;
  created_at: ISODateTime;
}

export interface AdminLease {
  id: number;
  owner: number;
  owner_email: string;
  property_name: string;
  tenant_name: string;
  start_date: string;
  end_date: string;
  rent_amount: Money;
  status: "active" | "ended";
  status_label: string;
}

export type AdminChannel = "email" | "telegram";

export interface AdminMessage {
  id: number;
  sender_email: string | null;
  subject: string;
  body: string;
  audience: "all" | "selected";
  channels: AdminChannel[];
  recipients_count: number;
  email_sent: number;
  telegram_sent: number;
  failed: number;
  created_at: ISODateTime;
}

export interface AdminMessageInput {
  subject: string;
  body: string;
  audience: "all" | "selected";
  user_ids: number[];
  channels: AdminChannel[];
}

export interface AdminAdmin {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  date_joined: ISODateTime;
  last_login: ISODateTime | null;
  is_self: boolean;
  role: "admin" | "support";
}

export interface AdminUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  is_active: boolean;
  date_joined: ISODateTime;
  last_login: ISODateTime | null;
  telegram_linked: boolean;
  properties_count: number;
  tenants_count: number;
  leases_count: number;
  plan: AdminUserPlan | null;
}

export interface AdminUserPlan {
  id: number;
  name: string;
  max_properties: number | null;
  paid_until: string | null;
  expired: boolean;
  note: string;
}

export interface AdminOverview {
  user: AdminUser;
  activity: { id: number; action: string; object_type: string; object_id: number | null; actor_email: string | null; created_at: ISODateTime }[];
  recent_payments: { id: number; amount: Money; provider: "manual" | "payme" | "click"; performed_at: ISODateTime | null; lease: number }[];
  notes: AdminNote[];
  properties: { id: number; name: string; address: string; kind: string }[];
  active_leases: { id: number; property: string; tenant: string; start_date: string; end_date: string; rent_amount: Money }[];
}

export interface AdminAuditEntry {
  id: number;
  owner: number;
  owner_email: string;
  actor: number | null;
  actor_email: string | null;
  action: string;
  object_type: string;
  object_id: number | null;
  details: Record<string, unknown>;
  created_at: ISODateTime;
}

export interface AdminTransaction {
  id: number;
  owner: number;
  owner_email: string;
  provider: "manual" | "payme" | "click";
  external_id: string;
  amount: Money;
  state: number;
  state_label: string;
  lease: number;
  payment: number;
  performed_at: ISODateTime | null;
  created_at: ISODateTime;
}

export const adminUsersApi = createResource<AdminUser, never, { page?: number; search?: string; is_active?: string }>({
  key: "admin-users",
  path: "/admin/users/",
});

export const adminAuditApi = createResource<AdminAuditEntry, never, { page?: number; search?: string; owner?: number | ""; action?: string; date_from?: string; date_to?: string }>({
  key: "admin-audit",
  path: "/admin/audit/",
});

export const adminTransactionsApi = createResource<
  AdminTransaction,
  never,
  { page?: number; search?: string; provider?: string; state?: string; problem?: string }
>({
  key: "admin-transactions",
  path: "/admin/transactions/",
});

export function useAdminStats() {
  return useQuery({
    queryKey: ["admin-stats"],
    queryFn: async ({ signal }) => (await api.get<AdminStats>("/admin/stats/", { signal })).data,
  });
}

export function useAdminOverview(id: number | undefined) {
  return useQuery({
    queryKey: ["admin-users", "overview", id],
    enabled: id !== undefined,
    queryFn: async ({ signal }) => (await api.get<AdminOverview>(`/admin/users/${id}/overview/`, { signal })).data,
  });
}

export type AdminUserAction = "block" | "unblock" | "reset-password";

export function useAdminUserAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: number; action: AdminUserAction }) =>
      (await api.post(`/admin/users/${id}/${action}/`)).data,
    onSuccess: () =>
      Promise.all(
        ["admin-users", "admin-stats", "admin-audit"].map((k) => qc.invalidateQueries({ queryKey: [k] })),
      ),
  });
}

export const adminTenantsApi = createResource<AdminTenant, never, { page?: number; search?: string }>({
  key: "admin-tenants",
  path: "/admin/tenants/",
});

export const adminLeasesApi = createResource<AdminLease, never, { page?: number; search?: string; status?: string }>({
  key: "admin-leases",
  path: "/admin/leases/",
});

export const adminMessagesApi = createResource<AdminMessage, AdminMessageInput, { page?: number }>({
  key: "admin-messages",
  path: "/admin/messages/",
  invalidates: ["admin-audit"],
});

export function useAdminDaily(days = 30) {
  return useQuery({
    queryKey: ["admin-stats", "daily", days],
    queryFn: async ({ signal }) => (await api.get<AdminDailyPoint[]>("/admin/stats/daily/", { params: { days }, signal })).data,
  });
}

export function useAdminAuditActions() {
  return useQuery({
    queryKey: ["admin-audit", "actions"],
    staleTime: 60_000,
    queryFn: async ({ signal }) => (await api.get<string[]>("/admin/audit/actions/", { signal })).data,
  });
}

export function useAdminAdmins() {
  return useQuery({
    queryKey: ["admin-admins"],
    queryFn: async ({ signal }) => (await api.get<AdminAdmin[]>("/admin/admins/", { signal })).data,
  });
}

export function useCreateAdminAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string; first_name?: string; role: "admin" | "support" }) =>
      (await api.post<AdminAdmin>("/admin/admins/", input)).data,
    onSuccess: () => Promise.all(["admin-admins", "admin-audit"].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
}

export function useRevokeAdminAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/admin/admins/${id}/`);
    },
    onSuccess: () => Promise.all(["admin-admins", "admin-audit"].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
}

/** Токен для просмотра сервиса глазами арендодателя (только чтение). */
export function useImpersonate() {
  return useMutation({
    mutationFn: async (id: number) =>
      (await api.post<{ access: string; email: string; expires_in: number }>(`/admin/users/${id}/impersonate/`)).data,
  });
}

/** Скачивает CSV того, что сейчас в списке: тот же путь + `export/` с теми же фильтрами. */
export async function downloadExport(path: string, filename: string, params: object = {}) {
  const res = await api.get<Blob>(`${path}export/`, { params: cleanParams(params), responseType: "blob", timeout: 60_000 });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ---------- тарифы, заметки, лента событий ---------- */

export interface AdminPlan {
  id: number;
  name: string;
  max_properties: number | null;
  price: Money;
  is_active: boolean;
  users_count: number;
}

export interface AdminPlanInput {
  name: string;
  max_properties: number | null;
  price: number;
  is_active: boolean;
}

export interface AdminNote {
  id: number;
  user: number;
  text: string;
  author_email: string | null;
  can_delete: boolean;
  created_at: ISODateTime;
}

export function useAdminPlans() {
  return useQuery({
    queryKey: ["admin-plans"],
    queryFn: async ({ signal }) => (await api.get<AdminPlan[]>("/admin/plans/", { signal })).data,
  });
}

function useInvalidateKeys(keys: string[]) {
  const qc = useQueryClient();
  return () => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useSavePlan() {
  const invalidate = useInvalidateKeys(["admin-plans", "admin-audit"]);
  return useMutation({
    mutationFn: async ({ id, input }: { id?: number; input: AdminPlanInput }) =>
      id === undefined
        ? (await api.post<AdminPlan>("/admin/plans/", input)).data
        : (await api.patch<AdminPlan>(`/admin/plans/${id}/`, input)).data,
    onSuccess: invalidate,
  });
}

export function useDeletePlan() {
  const invalidate = useInvalidateKeys(["admin-plans", "admin-audit"]);
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/admin/plans/${id}/`);
    },
    onSuccess: invalidate,
  });
}

export interface SubscriptionInput {
  plan: number | null;
  paid_until: string | null;
  note: string;
}

export function useSetSubscription() {
  const invalidate = useInvalidateKeys(["admin-users", "admin-plans", "admin-audit"]);
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: SubscriptionInput }) =>
      (await api.post<AdminUser>(`/admin/users/${id}/subscription/`, input)).data,
    onSuccess: invalidate,
  });
}

export function useAddAdminNote() {
  const invalidate = useInvalidateKeys(["admin-users"]);
  return useMutation({
    mutationFn: async (input: { user: number; text: string }) => (await api.post<AdminNote>("/admin/notes/", input)).data,
    onSuccess: invalidate,
  });
}

export function useDeleteAdminNote() {
  const invalidate = useInvalidateKeys(["admin-users"]);
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/admin/notes/${id}/`);
    },
    onSuccess: invalidate,
  });
}

/* ---------- состояние сервиса ---------- */

export interface AdminSystem {
  time: ISODateTime;
  checks: { database: "ok" | "fail"; cache: "ok" | "fail" };
  services: {
    email_real: boolean;
    email_backend: string;
    telegram_configured: boolean;
    sms_configured: boolean;
    payme_configured: boolean;
    click_configured: boolean;
    celery_eager: boolean;
  };
  reminders: {
    last_sent_at: ISODateTime | null;
    sent_24h: number;
    failed_24h: number;
    stuck: number;
    last_error: string;
  };
  leases: { expired_still_active: number };
  webhooks: { last_payme_at: ISODateTime | null; last_click_at: ISODateTime | null; failed_24h: number };
  alerts: { threshold: number; problem_24h: number; last_alert_at: ISODateTime | null };
}

export function useAdminSystem() {
  return useQuery({
    queryKey: ["admin-system"],
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => (await api.get<AdminSystem>("/admin/system/", { signal })).data,
  });
}

/* ---------- журнал вебхуков ---------- */

export interface AdminWebhook {
  id: number;
  provider: "payme" | "click";
  method: string;
  ok: boolean;
  error_code: string;
  payment_id: number | null;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  remote_addr: string | null;
  duration_ms: number;
  created_at: ISODateTime;
}

export const adminWebhooksApi = createResource<
  AdminWebhook,
  never,
  { page?: number; search?: string; provider?: string; ok?: string; payment?: string }
>({
  key: "admin-webhooks",
  path: "/admin/webhooks/",
});

/* ---------- объявления ---------- */

export type AnnouncementLevel = "info" | "warning";

export interface AdminAnnouncement {
  id: number;
  text_ru: string;
  text_uz: string;
  level: AnnouncementLevel;
  is_active: boolean;
  created_by_email: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface AdminAnnouncementInput {
  text_ru: string;
  text_uz: string;
  level: AnnouncementLevel;
  is_active: boolean;
}

export const adminAnnouncementsApi = createResource<
  AdminAnnouncement,
  AdminAnnouncementInput,
  { page?: number }
>({
  key: "admin-announcements",
  path: "/admin/announcements/",
  invalidates: ["announcements", "admin-audit"],
});

/** Отправка рассылки: письма уходят синхронно, поэтому таймаут больше обычного (сервер защищён от дублей). */
export function useSendAdminMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdminMessageInput) =>
      (await api.post<AdminMessage>("/admin/messages/", input, { timeout: 180_000 })).data,
    onSuccess: () => Promise.all(["admin-messages", "admin-audit"].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
}
