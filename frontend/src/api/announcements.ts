import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export interface Announcement {
  id: number;
  text_ru: string;
  text_uz: string;
  level: "info" | "warning";
}

/** Включённые объявления админа — для баннера в кабинете арендодателя и жильца. */
export function useAnnouncements() {
  return useQuery({
    queryKey: ["announcements"],
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => (await api.get<Announcement[]>("/announcements/", { signal })).data,
  });
}
