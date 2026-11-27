import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

interface Page<T> {
  results: T[];
}

const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

// ---------- Ремонт ----------
export type RepairStatus = "new" | "in_progress" | "done" | "rejected";

export interface Repair {
  id: number;
  lease: number;
  property_name: string;
  tenant_name: string;
  title: string;
  description: string;
  status: RepairStatus;
  landlord_comment: string;
  has_photo: boolean;
  created_at: string;
  resolved_at: string | null;
}

// ---------- Счётчики ----------
export type MeterKind = "electricity" | "water_cold" | "water_hot" | "gas";
export const METER_KINDS: readonly MeterKind[] = ["electricity", "water_cold", "water_hot", "gas"];

export interface MeterEntry {
  id: number;
  lease: number;
  property_name: string;
  tenant_name: string;
  kind: MeterKind;
  /** первое число месяца, за который показание */
  period: string;
  value: number;
  has_photo: boolean;
  created_at: string;
}

// ---------- Продление и выезд ----------
export type LeaseRequestKind = "extend" | "leave";
export type LeaseRequestStatus = "pending" | "accepted" | "declined" | "cancelled";

export interface LeaseRequest {
  id: number;
  lease: number;
  property_name: string;
  tenant_name: string;
  kind: LeaseRequestKind;
  months: number | null;
  move_out_date: string | null;
  comment: string;
  status: LeaseRequestStatus;
  landlord_comment: string;
  created_at: string;
  resolved_at: string | null;
}

// ---------- Жилец ----------
export function useTenantRepairs() {
  return useQuery({
    queryKey: ["tenant", "repairs"],
    queryFn: async ({ signal }) =>
      (await api.get<Page<Repair>>("/tenant/repairs/", { params: { page_size: 100 }, signal })).data.results,
  });
}

export function useCreateRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lease: number; title: string; description: string; photo: File | null }) => {
      const form = new FormData();
      form.append("lease", String(input.lease));
      form.append("title", input.title);
      if (input.description) form.append("description", input.description);
      if (input.photo) form.append("photo", input.photo);
      return (await api.post<Repair>("/tenant/repairs/", form, MULTIPART)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", "repairs"] }),
  });
}

export function useTenantMeters() {
  return useQuery({
    queryKey: ["tenant", "meters"],
    queryFn: async ({ signal }) =>
      (await api.get<Page<MeterEntry>>("/tenant/meter-readings/", { params: { page_size: 100 }, signal })).data.results,
  });
}

export function useSubmitMeter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lease: number; kind: MeterKind; value: number; photo: File | null }) => {
      const form = new FormData();
      form.append("lease", String(input.lease));
      form.append("kind", input.kind);
      form.append("value", String(input.value));
      if (input.photo) form.append("photo", input.photo);
      return (await api.post<MeterEntry>("/tenant/meter-readings/", form, MULTIPART)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", "meters"] }),
  });
}

export function useTenantLeaseRequests() {
  return useQuery({
    queryKey: ["tenant", "lease-requests"],
    queryFn: async ({ signal }) =>
      (await api.get<Page<LeaseRequest>>("/tenant/lease-requests/", { params: { page_size: 50 }, signal })).data.results,
  });
}

export function useCreateLeaseRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      lease: number;
      kind: LeaseRequestKind;
      months?: number;
      move_out_date?: string;
      comment: string;
    }) => (await api.post<LeaseRequest>("/tenant/lease-requests/", input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", "lease-requests"] }),
  });
}

export function useCancelLeaseRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.post(`/tenant/lease-requests/${id}/cancel/`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", "lease-requests"] }),
  });
}

// ---------- Арендодатель ----------
export function useRepairs(status?: RepairStatus, property?: number) {
  return useQuery({
    queryKey: ["repairs", status ?? "all", property ?? "any"],
    queryFn: async ({ signal }) =>
      (await api.get<Page<Repair>>("/repairs/", { params: { status, lease__property: property, page_size: 100 }, signal })).data.results,
  });
}

export function useSetRepairStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, comment }: { id: number; status: RepairStatus; comment: string }) =>
      (await api.post<Repair>(`/repairs/${id}/set-status/`, { status, landlord_comment: comment })).data,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["repairs"] }), qc.invalidateQueries({ queryKey: ["pending-count"] })]),
  });
}

export function useLandlordMeters(property?: number) {
  return useQuery({
    queryKey: ["tenant-meters", property ?? "any"],
    queryFn: async ({ signal }) =>
      (await api.get<Page<MeterEntry>>("/tenant-meter-readings/", { params: { lease__property: property, page_size: 100 }, signal })).data.results,
  });
}

export function useLandlordLeaseRequests(status?: LeaseRequestStatus) {
  return useQuery({
    queryKey: ["lease-requests", status ?? "all"],
    queryFn: async ({ signal }) =>
      (await api.get<Page<LeaseRequest>>("/lease-requests/", { params: { status, page_size: 100 }, signal })).data.results,
  });
}

export function useResolveLeaseRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, accept, comment }: { id: number; accept: boolean; comment: string }) =>
      (await api.post<LeaseRequest>(`/lease-requests/${id}/${accept ? "accept" : "decline"}/`, { comment })).data,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["lease-requests"] }), qc.invalidateQueries({ queryKey: ["pending-count"] })]),
  });
}

/** Число ожидающих ответа заявок и просьб — для бейджа в меню арендодателя. */
export function usePendingRequestsCount(enabled = true) {
  const repairs = useQuery({
    queryKey: ["pending-count", "repairs"],
    enabled,
    refetchInterval: 120_000,
    queryFn: async ({ signal }) =>
      (await api.get<{ count: number }>("/repairs/", { params: { status: "new", page_size: 1 }, signal })).data.count,
  });
  const requests = useQuery({
    queryKey: ["pending-count", "lease-requests"],
    enabled,
    refetchInterval: 120_000,
    queryFn: async ({ signal }) =>
      (await api.get<{ count: number }>("/lease-requests/", { params: { status: "pending", page_size: 1 }, signal })).data.count,
  });
  return (repairs.data ?? 0) + (requests.data ?? 0);
}
