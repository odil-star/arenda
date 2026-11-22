import type { ReactNode } from "react";
import { Brand } from "@/components/layout/brand";
import { LanguageSwitcher, ThemeSwitcher } from "@/components/layout/preferences";

/** Простая страница по центру: для приглашения и входа жильца. */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Brand />
        <div className="flex items-center gap-0.5">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-8 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm animate-rise-in">{children}</div>
      </main>
    </div>
  );
}
