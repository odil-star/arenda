import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

/** VIP: ключ API и webhook. Секреты приходят только в ответе на создание/перевыпуск (поле secret). */
export interface IntegrationsState {
  available: boolean;
  api_key: { prefix: string; created_at: string; last_used_at: string | null } | null;
  webhook: {
    url: string;
    is_active: boolean;
    last_status: number | null;
    last_error: string;
    last_attempt_at: string | null;
  } | null;
}

export type WithSecret = IntegrationsState & { secret?: string };

const KEY = ["integrations"] as const;

export function useIntegrations() {
  return useQuery({
    queryKey: KEY,
    queryFn: async ({ signal }) => (await api.get<IntegrationsState>("/integrations/", { signal })).data,
  });
}

function useStateMutation<T>(fn: (input: T) => Promise<WithSecret | void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      if (data) {
        // секрет в кэш не кладём: он нужен только для одноразового показа
        qc.setQueryData(KEY, { available: data.available, api_key: data.api_key, webhook: data.webhook });
      } else {
        void qc.invalidateQueries({ queryKey: KEY });
      }
    },
  });
}

export const useIssueApiKey = () => useStateMutation<void>(async () => (await api.post<WithSecret>("/integrations/api-key/")).data);
export const useRevokeApiKey = () => useStateMutation<void>(async () => void (await api.delete("/integrations/api-key/")));
export const useSaveWebhook = () =>
  useStateMutation<{ url: string; is_active: boolean }>(async (input) => (await api.put<WithSecret>("/integrations/webhook/", input)).data);
export const useDeleteWebhook = () => useStateMutation<void>(async () => void (await api.delete("/integrations/webhook/")));
export const useRotateWebhookSecret = () =>
  useStateMutation<void>(async () => (await api.post<WithSecret>("/integrations/webhook/rotate-secret/")).data);

export function useTestWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<{ ok: boolean; status?: number; error?: string }>("/integrations/webhook/test/")).data,
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Скачать CSV для бухгалтерии (по обычному входу, без ключа). */
export async function downloadAccountingCsv(kind: "transactions" | "payments", range: { from?: string; to?: string }) {
  const res = await api.get<Blob>(`/v1/${kind}/`, {
    params: { file: "csv", date_from: range.from || undefined, date_to: range.to || undefined },
    responseType: "blob",
    timeout: 60_000,
  });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
