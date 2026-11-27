import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, cleanParams } from "./client";
import type { Amenity, Furniture, ISODateTime, Paginated, PropertyKind, Renovation } from "./types";

const baseURL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

/** Публичные фото отдаются без авторизации — можно ставить прямо в <img src>. */
export const publicFileUrl = (path: string) => `${baseURL}${path}`;

// ---------- Публичный поиск ----------
export interface Listing {
  id: number;
  title: string;
  address: string;
  kind: PropertyKind;
  area_m2: string | null;
  rooms: number | null;
  price: number;
  description: string;
  /** телефон для связи с владельцем */
  phone: string;
  has_telegram: boolean;
  floor: number | null;
  floors_total: number | null;
  renovation: Renovation | "";
  furniture: Furniture | "";
  amenities: Amenity[];
  latitude: string | null;
  longitude: string | null;
  /** имя владельца (может быть пустым) */
  owner: number;
  owner_name: string;
  /** дата регистрации владельца (YYYY-MM-DD) */
  owner_since: string;
  owner_listings: number;
  /** Prime: объявление закреплено вверху ленты */
  boosted?: boolean;
  /** чей закреп: vip выше prime */
  boost_tier?: "vip" | "prime" | null;
  photos: string[];
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface ListingParams {
  page?: number;
  page_size?: number;
  search?: string;
  kind?: PropertyKind;
  rooms?: number;
  owner?: number;
  price_min?: number;
  price_max?: number;
  area_min?: number;
  area_max?: number;
  renovation?: Renovation;
  furniture?: Furniture;
  /** ключи через запятую: нужны все */
  amenities?: string;
  new_days?: number;
  has_photo?: 1;
  ordering?: string;
}

export interface ListingStats {
  count: number;
  owners: number;
  min_price: number | null;
  new_week: number;
}

export function useListingStats() {
  return useQuery({
    queryKey: ["listings", "stats"],
    staleTime: 60_000,
    queryFn: async ({ signal }) => (await api.get<ListingStats>("/listings/stats/", { signal })).data,
  });
}

export interface SavedSearchLink {
  token: string;
  start_command: string;
  /** null, если имя бота не настроено на сервере */
  link: string | null;
}

/** Сохранить текущие фильтры: гость получает ссылку на Telegram-бота. */
export function useSaveSearch() {
  return useMutation({
    mutationFn: async (input: { filters: Record<string, string>; language: string }) =>
      (await api.post<SavedSearchLink>("/listings/saved-searches/", input)).data,
  });
}


export function useListings(params: ListingParams) {
  return useQuery({
    queryKey: ["listings", params],
    queryFn: async ({ signal }) =>
      (await api.get<Paginated<Listing>>("/listings/", { params: cleanParams(params), signal })).data,
    placeholderData: keepPreviousData,
  });
}

export function useListing(id: number | undefined) {
  return useQuery({
    queryKey: ["listings", "detail", id],
    enabled: id !== undefined && Number.isFinite(id),
    queryFn: async ({ signal }) => (await api.get<Listing>(`/listings/${id}/`, { signal })).data,
  });
}

export function useSimilarListings(id: number | undefined) {
  return useQuery({
    queryKey: ["listings", "similar", id],
    enabled: id !== undefined && Number.isFinite(id),
    queryFn: async ({ signal }) => (await api.get<Listing[]>(`/listings/${id}/similar/`, { signal })).data,
  });
}

// ---------- Фото объекта (документы kind=photo) ----------
export interface PropertyPhoto {
  id: number;
  original_name: string;
  created_at: ISODateTime;
}

export function usePropertyPhotos(propertyId: number) {
  return useQuery({
    queryKey: ["property-photos", propertyId],
    queryFn: async ({ signal }) =>
      (await api.get<Paginated<PropertyPhoto>>("/documents/", {
        params: { property: propertyId, kind: "photo", page_size: 100 }, signal,
      })).data.results,
  });
}

export function useUploadPropertyPhoto(propertyId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "photo");
      form.append("property", String(propertyId));
      return (await api.post<PropertyPhoto>("/documents/", form, {
        headers: { "Content-Type": "multipart/form-data" }, timeout: 120_000,
      })).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["property-photos", propertyId] }),
  });
}

export function useDeletePropertyPhoto(propertyId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/documents/${id}/`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["property-photos", propertyId] }),
  });
}
