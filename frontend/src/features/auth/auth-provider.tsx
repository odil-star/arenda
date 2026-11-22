import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOGOUT_EVENT, tokens } from "@/api/tokens";
import type { TokenPair } from "@/api/types";
import { AuthContext } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState(() => ({
    isAuthenticated: Boolean(tokens.refresh || tokens.impersonating), // у токена просмотра refresh нет
    username: tokens.username,
  }));

  const reset = useCallback(() => {
    queryClient.clear();
    setState({ isAuthenticated: false, username: null });
  }, [queryClient]);

  // interceptor не смог обновить токен → выходим (guard отправит на /login)
  useEffect(() => {
    window.addEventListener(LOGOUT_EVENT, reset);
    return () => window.removeEventListener(LOGOUT_EVENT, reset);
  }, [reset]);

  const value = useMemo(
    () => ({
      ...state,
      signIn: (pair: TokenPair, username: string) => {
        tokens.setPair(pair, username);
        queryClient.removeQueries({ queryKey: ["role"] });
        queryClient.removeQueries({ queryKey: ["me"] });
        queryClient.removeQueries({ queryKey: ["tenant"] });
        setState({ isAuthenticated: true, username });
      },
      signOut: () => {
        tokens.clear();
        reset();
      },
    }),
    [state, reset, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
