import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { api } from "./client";
import type { PaymentStatus, TokenPair } from "./types";

// ---------- Роль ----------
export type Role = "landlord" | "tenant";

/**
 * Роль текущего аккаунта. /api/me/ — только для арендодателя (жильцу 403),
 * поэтому 403 означает «жилец». Кеш сбрасывается при входе/выходе (AuthProvider).
 */
export function useRole(enabled = true) {
  return useQuery({
    queryKey: ["role"],
    enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }): Promise<Role> => {
      try {
        await api.get("/me/", { signal });
        return "landlord";
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 403) return "tenant";
        throw error;
      }
    },
  });
}

// ---------- Приглашения и вход жильца ----------
export interface InvitePreview {
  valid: boolean;
  landlord_name: string;
  property_name: string | null;
  /** true — жилец вводит имя и телефон сам */
  needs_profile: boolean;
}

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: ["invite-preview", token],
    retry: false,
    staleTime: Infinity,
    queryFn: async ({ signal }) => (await api.get<InvitePreview>(`/invites/${encodeURIComponent(token)}/`, { signal })).data,
  });
}

export interface ProfileInput {
  full_name?: string;
  phone?: string;
}

export function useAcceptInvite() {
  return useMutation({
    mutationFn: async (input: { token: string } & ProfileInput) =>
      (await api.post<{ tenant: number; landlord_name: string }>("/invites/accept/", input)).data,
  });
}

export interface RegisterTenantInput extends ProfileInput {
  token: string;
  email: string;
  password: string;
}

/** Регистрация по приглашению и сразу вход. */
export function useRegisterTenant() {
  return useMutation({
    mutationFn: async (input: RegisterTenantInput) => {
      await api.post("/auth/register-tenant/", input);
      return (await api.post<TokenPair>("/auth/token/", { email: input.email, password: input.password })).data;
    },
  });
}

export function usePhoneRequest() {
  return useMutation({
    mutationFn: async (phone: string) => (await api.post("/auth/phone/request/", { phone })).data,
  });
}

/** Вход жильца по телефону и паролю. */
export function usePhonePasswordLogin() {
  return useMutation({
    mutationFn: async (input: { phone: string; password: string }) =>
      (await api.post<TokenPair>("/auth/phone/password/", input)).data,
  });
}

export function useSetTenantPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { password: string; current_password?: string }) => {
      await api.post("/tenant/password/", input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", "me"] }),
  });
}

export function usePhoneVerify() {
  return useMutation({
    mutationFn: async (input: { phone: string; code: string }) =>
      (await api.post<TokenPair>("/auth/phone/verify/", input)).data,
  });
}

// ---------- Кабинет жильца ----------
export interface TenantMe {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  language: "ru" | "uz";
  has_password: boolean;
  telegram_linked: boolean;
  tours_seen?: string[];
  landlords: { tenant: number; full_name: string; landlord_name: string }[];
}

export interface TenantLease {
  id: number;
  property_name: string;
  property_address: string;
  landlord_name: string;
  start_date: string;
  end_date: string;
  rent_amount: number;
  deposit_amount: number;
  payment_day: number;
  inventory: string;
  status: "active" | "ended";
}

export interface TenantPayment {
  id: number;
  lease: number;
  property_name: string;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  remaining: number;
  status: PaymentStatus;
  paid_at: string | null;
  can_pay: boolean;
  receipt_status: "none" | ReceiptStatus;
  receipt_reject_reason: string;
  landlord_name: string;
  payment_details: string;
}

interface Page<T> {
  results: T[];
}

export function useTenantMe(enabled = true) {
  return useQuery({
    queryKey: ["tenant", "me"],
    enabled,
    queryFn: async ({ signal }) => (await api.get<TenantMe>("/tenant/me/", { signal })).data,
  });
}

export type TenantProfileInput = Partial<Pick<TenantMe, "first_name" | "last_name" | "phone" | "language">>;

/** Прогресс обучения (оба вида пользователей): сервер помнит, на каком шаге человек остановился и прошёл ли он обучение. */
export function useSaveTourProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: Role; step: number; done: boolean }) =>
      (await api.post<{ tours_seen: string[] }>("/tour/", input)).data,
    onSuccess: ({ tours_seen }) => {
      const patch = <T extends { tours_seen?: string[] }>(old: T | undefined) => (old ? { ...old, tours_seen } : old);
      qc.setQueryData(["me"], patch);
      qc.setQueryData(["tenant", "me"], patch);
    },
  });
}

export function useUpdateTenantProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TenantProfileInput) => (await api.patch<TenantMe>("/tenant/me/", input)).data,
    onSuccess: (data) => qc.setQueryData(["tenant", "me"], data),
  });
}

export function useTenantLeases() {
  return useQuery({
    queryKey: ["tenant", "leases"],
    queryFn: async ({ signal }) =>
      (await api.get<Page<TenantLease>>("/tenant/leases/", { params: { page_size: 100 }, signal })).data.results,
  });
}

/** Убрать завершённый договор из кабинета (у арендодателя он остаётся). */
export function useHideTenantLease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leaseId: number) => {
      await api.post(`/tenant/leases/${leaseId}/hide/`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant"] }),
  });
}

export function useTenantPayments(status?: PaymentStatus) {
  return useQuery({
    queryKey: ["tenant", "payments", status ?? "all"],
    queryFn: async ({ signal }) =>
      (
        await api.get<Page<TenantPayment>>("/tenant/payments/", {
          params: { page_size: 100, ordering: "due_date", status },
          signal,
        })
      ).data.results,
  });
}

// ---------- Чеки об оплате ----------
export type ReceiptStatus = "pending" | "confirmed" | "rejected";

export interface Receipt {
  id: number;
  payment: number;
  property_name: string;
  tenant_name: string;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  amount: number;
  status: ReceiptStatus;
  reject_reason: string;
  original_name: string;
  content_type: string;
  created_at: string;
  reviewed_at: string | null;
}

/** Жилец: отправить чек (multipart). */
export function useSendReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ paymentId, file, amount }: { paymentId: number; file: File; amount: number }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("amount", String(amount));
      await api.post(`/tenant/payments/${paymentId}/receipts/`, form, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", "payments"] }),
  });
}

/** Скачать PDF-квитанцию по оплаченному платежу (нужен JWT, поэтому через blob). */
export async function downloadPaymentReceipt(paymentId: number) {
  const res = await api.get<Blob>(`/tenant/payments/${paymentId}/receipt/`, { responseType: "blob", timeout: 60_000 });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `receipt-${paymentId}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Арендодатель: список чеков. */
export function useReceipts(status?: ReceiptStatus) {
  return useQuery({
    queryKey: ["receipts", status ?? "all"],
    queryFn: async ({ signal }) =>
      (await api.get<Page<Receipt>>("/receipts/", { params: { status, page_size: 100 }, signal })).data.results,
  });
}

/** Файл чека (с JWT, поэтому через blob). */
export function useReceiptFile(id: number | undefined) {
  return useQuery({
    queryKey: ["receipt-file", id],
    enabled: id !== undefined,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) =>
      (await api.get<Blob>(`/receipts/${id}/file/`, { responseType: "blob", signal })).data,
  });
}

function useAfterReview() {
  const qc = useQueryClient();
  return () =>
    Promise.all(["receipts", "payments", "dashboard"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useConfirmReceipt() {
  const done = useAfterReview();
  return useMutation({
    mutationFn: async ({ id, amount }: { id: number; amount?: number }) =>
      (await api.post<Receipt>(`/receipts/${id}/confirm/`, amount ? { amount } : {})).data,
    onSuccess: done,
  });
}

export interface BulkConfirmResult {
  confirmed: number[];
  failed: number[];
  not_found: number[];
}

export function useBulkConfirmReceipts() {
  const done = useAfterReview();
  return useMutation({
    mutationFn: async (ids: number[]) =>
      (await api.post<BulkConfirmResult>("/receipts/bulk-confirm/", { ids })).data,
    onSuccess: done,
  });
}

export interface RemindResult {
  sent: number;
  no_telegram: number;
  already: number;
  failed: number;
}

/** Напомнить должникам в Telegram. */
export function useRemindPayments() {
  return useMutation({
    mutationFn: async (ids: number[]) => (await api.post<RemindResult>("/payments/remind/", { ids })).data,
  });
}

export function useRejectReceipt() {
  const done = useAfterReview();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) =>
      (await api.post<Receipt>(`/receipts/${id}/reject/`, { reason })).data,
    onSuccess: done,
  });
}

// ---------- Фото и видео состояния квартиры ----------
export type MediaKind = "photo" | "video";

export interface LeaseMedia {
  id: number;
  lease: number;
  kind: MediaKind;
  original_name: string;
  content_type: string;
  size: number;
  created_at: string;
}

export const MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";
export const MEDIA_MAX_PHOTO = 15 * 1024 * 1024;
export const MEDIA_MAX_VIDEO = 100 * 1024 * 1024;
export const MEDIA_MAX_FILES = 40;

/** Файл по защищённой ссылке (нужен JWT, поэтому через blob). */
export function useMediaBlob(path: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["media-blob", path],
    enabled: enabled && path !== undefined,
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async ({ signal }) => (await api.get<Blob>(path!, { responseType: "blob", signal })).data,
  });
}

/** Арендодатель: материалы договора. */
export function useLeaseMedia(leaseId: number | undefined) {
  return useQuery({
    queryKey: ["lease-media", leaseId],
    enabled: leaseId !== undefined,
    queryFn: async ({ signal }) =>
      (await api.get<Page<LeaseMedia>>("/lease-media/", { params: { lease: leaseId, page_size: 100 }, signal })).data.results,
  });
}

function postFile(url: string, file: File, extra?: Record<string, string | number>) {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(extra ?? {})) form.append(k, String(v));
  return api.post<LeaseMedia>(url, form, { headers: { "Content-Type": "multipart/form-data" } });
}

export function useUploadLeaseMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leaseId, file }: { leaseId: number; file: File }) =>
      (await postFile("/lease-media/", file, { lease: leaseId })).data,
    onSuccess: (item) => qc.invalidateQueries({ queryKey: ["lease-media", item.lease] }),
  });
}

export function useReplaceLeaseMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => (await postFile(`/lease-media/${id}/replace/`, file)).data,
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: ["media-blob", `/lease-media/${item.id}/file/`] });
      return qc.invalidateQueries({ queryKey: ["lease-media", item.lease] });
    },
  });
}

export function useDeleteLeaseMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: LeaseMedia) => {
      await api.delete(`/lease-media/${item.id}/`);
      return item;
    },
    onSuccess: (item) => qc.invalidateQueries({ queryKey: ["lease-media", item.lease] }),
  });
}

/** Жилец: материалы своего договора и уведомления о них. */
export function useTenantMedia(leaseId: number | undefined) {
  return useQuery({
    queryKey: ["tenant", "media", leaseId],
    enabled: leaseId !== undefined,
    queryFn: async ({ signal }) =>
      (await api.get<Page<LeaseMedia>>("/tenant/media/", { params: { lease: leaseId, page_size: 100 }, signal })).data.results,
  });
}

export interface TenantNotification {
  id: number;
  kind: "media_added" | "media_changed";
  lease: number | null;
  property_name: string;
  count: number;
  is_read: boolean;
  created_at: string;
}

export function useTenantNotifications(enabled = true) {
  return useQuery({
    queryKey: ["tenant", "notifications"],
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) =>
      (await api.get<Page<TenantNotification>>("/tenant/notifications/", { params: { page_size: 50 }, signal })).data.results,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post("/tenant/notifications/read/");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", "notifications"] }),
  });
}

/** Привязка Telegram жильца: код для бота / отвязка. */
export function useTenantTelegramCode() {
  return useMutation({
    mutationFn: async () => (await api.post<{ code: string; expires_at: string }>("/tenant/telegram-link/")).data,
  });
}

export function useTenantTelegramUnlink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.delete("/tenant/telegram-link/");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", "me"] }),
  });
}
