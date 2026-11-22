import { createContext, useContext } from "react";

export type ThemeSetting = "light" | "dark" | "system";

export interface ThemeContextValue {
  theme: ThemeSetting;
  resolved: "light" | "dark";
  setTheme: (theme: ThemeSetting) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
