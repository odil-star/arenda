import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMediaQuery } from "./hooks";
import { ThemeContext, type ThemeSetting } from "./theme-context";

const STORAGE_KEY = "theme";

/** Тёмная тема — по умолчанию; явный выбор пользователя (в т.ч. «как в системе») сохраняется. */
function readStored(): ThemeSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeSetting>(readStored);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    // публичные страницы объявлений всегда светлые (см. ListingsLayout) — пока они открыты, тему не применяем
    if (document.documentElement.dataset.themeLock === "light") return;
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const value = useMemo(
    () => ({
      theme,
      resolved,
      setTheme: (next: ThemeSetting) => {
        setThemeState(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* без сохранения */
        }
      },
    }),
    [theme, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
