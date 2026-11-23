import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from "@simplewebauthn/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { TokenPair } from "@/api/types";

export interface Passkey {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export const passkeysSupported = () => typeof window !== "undefined" && browserSupportsWebAuthn();

/** Пользователь закрыл системное окно или не дал отпечаток — это не ошибка. */
export function isCancelled(error: unknown) {
  return error instanceof WebAuthnError && (error.name === "NotAllowedError" || error.name === "AbortError");
}

/** Вход: сервер выдаёт задачу, устройство подписывает её отпечатком, сервер проверяет подпись. */
export async function signInWithPasskey(): Promise<TokenPair> {
  const { data } = await api.post<{ session: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>(
    "/auth/passkeys/login/options/",
  );
  const credential = await startAuthentication({ optionsJSON: data.options });
  return (await api.post<TokenPair>("/auth/passkeys/login/verify/", { session: data.session, credential })).data;
}

export function usePasskeys() {
  return useQuery({
    queryKey: ["passkeys"],
    queryFn: async ({ signal }) => (await api.get<Passkey[]>("/auth/passkeys/", { signal })).data,
  });
}

export function useAddPasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data } = await api.post<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/auth/passkeys/register/options/");
      const credential = await startRegistration({ optionsJSON: data });
      await api.post("/auth/passkeys/register/verify/", { credential, name });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["passkeys"] }),
  });
}

export function useRemovePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => void (await api.delete(`/auth/passkeys/${id}/`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["passkeys"] }),
  });
}
