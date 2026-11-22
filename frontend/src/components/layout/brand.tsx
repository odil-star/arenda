import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Знак бренда: восьмиконечная звезда — тот же мотив, что и в орнаменте. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("brand-mark flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary shadow-[0_0_18px_var(--glow)]", className)} aria-hidden>
      <svg viewBox="0 0 32 32" className="size-full">
        <g fill="none" stroke="var(--primary-foreground)" strokeWidth="1.7" strokeLinejoin="round">
          <rect x="10" y="10" width="12" height="12" />
          <rect x="10" y="10" width="12" height="12" transform="rotate(45 16 16)" />
        </g>
        <circle cx="16" cy="16" r="2.2" fill="var(--primary-foreground)" />
      </svg>
    </span>
  );
}

export function Brand({ compact, className }: { compact?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className={cn("font-display text-[17px] font-semibold tracking-tight", compact && "sr-only")}>{t("app.name")}</span>
    </span>
  );
}
