import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { api, cleanParams } from "./client";
import type { Paginated } from "./types";

interface ResourceOptions {
  /** Ключ кеша TanStack Query, например "properties" */
  key: string;
  /** Путь относительно /api, например "/properties/" */
  path: string;
  /** Какие ещё ключи сбрасывать после изменений */
  invalidates?: readonly string[];
}

/**
 * Общие CRUD-хуки для REST-ресурса DRF.
 * Список — пагинированный, остальные операции сбрасывают кеш ресурса и связанных ключей.
 */
export function createResource<T extends { id: number }, TInput, TParams extends object>({
  key,
  path,
  invalidates = [],
}: ResourceOptions) {
  const keys = {
    all: [key] as const,
    list: (params: TParams) => [key, "list", params] as const,
    detail: (id: number) => [key, "detail", id] as const,
  };

  const url = (id?: number) => (id === undefined ? path : `${path}${id}/`);

  function useInvalidate() {
    const qc = useQueryClient();
    return () =>
      Promise.all(
        [key, ...invalidates].map((k) => qc.invalidateQueries({ queryKey: [k] as QueryKey })),
      );
  }

  return {
    keys,

    useList(
      params: TParams,
      options: { enabled?: boolean; select?: (data: Paginated<T>) => Paginated<T> } = {},
    ) {
      return useQuery({
        queryKey: keys.list(params),
        queryFn: async ({ signal }) =>
          (await api.get<Paginated<T>>(url(), { params: cleanParams(params), signal })).data,
        placeholderData: keepPreviousData,
        enabled: options.enabled ?? true,
        select: options.select,
      });
    },

    useOne(id: number | undefined) {
      return useQuery({
        queryKey: keys.detail(id ?? -1),
        queryFn: async ({ signal }) => (await api.get<T>(url(id), { signal })).data,
        enabled: id !== undefined && Number.isFinite(id),
        staleTime: 60_000,
      });
    },

    useCreate() {
      const invalidate = useInvalidate();
      return useMutation({
        mutationFn: async (input: TInput) => (await api.post<T>(url(), input)).data,
        onSuccess: invalidate,
      });
    },

    useUpdate() {
      const invalidate = useInvalidate();
      return useMutation({
        mutationFn: async ({ id, input }: { id: number; input: TInput }) =>
          (await api.put<T>(url(id), input)).data,
        onSuccess: invalidate,
      });
    },

    useRemove() {
      const invalidate = useInvalidate();
      return useMutation({
        mutationFn: async (id: number) => {
          await api.delete(url(id));
        },
        onSuccess: invalidate,
      });
    },
  };
}
