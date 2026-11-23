import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * Знак бренда. Цвета берутся из темы.
 * "key"   — метка на карте с домом и ключом: кабинет арендодателя.
 * "house" — дом с замочной скважиной: страницы жильца (вход, приглашение, кабинет).
 */
export type BrandVariant = "key" | "house";

export function BrandMark({ className, variant = "key" }: { className?: string; variant?: BrandVariant }) {
  return (
    <span className={cn("brand-mark flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary shadow-[0_0_18px_var(--glow)]", className)} aria-hidden>
      <svg viewBox="0 0 100 100" className="size-full">
        {variant === "house" ? (
          <g transform="translate(18 18) scale(0.64)">
            <path
              d="M14 48 50 16l36 32v38a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4Z"
              fill="none"
              stroke="var(--primary-foreground)"
              strokeWidth="9"
              strokeLinejoin="round"
            />
            <g fill="var(--primary-foreground)" opacity="0.6">
              <circle cx="50" cy="58" r="9" />
              <path d="M45.2 62h9.6l3.2 20H42Z" />
            </g>
          </g>
        ) : (
          <g transform="translate(18 18) scale(0.64)" fill="var(--primary-foreground)">
            <g opacity="0.6">
              <rect x="45.5" y="62" width="9" height="32" rx="2" />
              <rect x="54" y="77" width="12" height="6.5" rx="1.5" />
              <rect x="54" y="87.5" width="8.5" height="6.5" rx="1.5" />
            </g>
            <path
              fillRule="evenodd"
              d="M50 6C64.4 6 76 17.6 76 32c0 14-12.5 25.5-26 40C36.5 57.5 24 46 24 32 24 17.6 35.6 6 50 6ZM50 20.5 63 31.5H59.5V43H40.5V31.5H37Z"
            />
            <rect x="46.5" y="34" width="7" height="9" rx="1" opacity="0.6" />
          </g>
        )}
      </svg>
    </span>
  );
}

export function Brand({ compact, className, variant }: { compact?: boolean; className?: string; variant?: BrandVariant }) {
  const { t } = useTranslation();
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark variant={variant} />
      <span className={cn("font-display text-[17px] font-semibold tracking-tight", compact && "sr-only")}>{t("app.name")}</span>
    </span>
  );
}
