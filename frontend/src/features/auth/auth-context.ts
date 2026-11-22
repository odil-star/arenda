import { createContext, useContext } from "react";
import type { TokenPair } from "@/api/types";

export interface AuthContextValue {
  isAuthenticated: boolean;
  username: string | null;
  signIn: (pair: TokenPair, username: string) => void;
  signOut: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
