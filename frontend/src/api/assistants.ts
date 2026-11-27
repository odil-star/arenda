import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export type AssistantRole = "accountant" | "manager";

/** VIP: помощник владельца (свой вход, ограниченный доступ). */
export interface Assistant {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: AssistantRole;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

/** Ответ на создание и сброс пароля: временный пароль виден один раз. */
export type AssistantWithPassword = Assistant & { password: string };

export interface AssistantInput {
  email: string;
  first_name: string;
  last_name?: string;
  role: AssistantRole;
}

const KEY = ["assistants"] as const;

export function useAssistants(enabled = true) {
  return useQuery({
    queryKey: KEY,
    enabled,
    queryFn: async ({ signal }) => (await api.get<{ results: Assistant[]; limit: number }>("/assistants/", { signal })).data,
  });
}

function useInvalidating<T, R>(fn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export const useCreateAssistant = () =>
  useInvalidating(async (input: AssistantInput) => (await api.post<AssistantWithPassword>("/assistants/", input)).data);
export const useUpdateAssistant = () =>
  useInvalidating(async ({ id, ...patch }: { id: number; role?: AssistantRole; is_active?: boolean }) =>
    (await api.patch<Assistant>(`/assistants/${id}/`, patch)).data);
export const useDeleteAssistant = () =>
  useInvalidating(async (id: number) => void (await api.delete(`/assistants/${id}/`)));
export const useResetAssistantPassword = () =>
  useInvalidating(async (id: number) => (await api.post<AssistantWithPassword>(`/assistants/${id}/reset-password/`)).data);
