import { Building, Building2, Home, Store, type LucideIcon } from "lucide-react";
import type { PropertyKind } from "@/api/types";
import { cn } from "@/lib/utils";

/* Мягкие пары «фон / текст» для светлой и тёмной темы. Цвет у человека стабильный. */
const TONES = [
  "bg-[oklch(0.93_0.04_195)] text-[oklch(0.38_0.08_195)] dark:bg-[oklch(0.32_0.05_195)] dark:text-[oklch(0.88_0.06_195)]",
  "bg-[oklch(0.93_0.05_75)] text-[oklch(0.42_0.09_60)] dark:bg-[oklch(0.33_0.05_70)] dark:text-[oklch(0.88_0.07_75)]",
  "bg-[oklch(0.93_0.04_300)] text-[oklch(0.42_0.1_300)] dark:bg-[oklch(0.32_0.05_300)] dark:text-[oklch(0.88_0.06_300)]",
  "bg-[oklch(0.93_0.045_25)] text-[oklch(0.45_0.12_25)] dark:bg-[oklch(0.33_0.06_25)] dark:text-[oklch(0.88_0.06_25)]",
  "bg-[oklch(0.93_0.045_145)] text-[oklch(0.4_0.1_145)] dark:bg-[oklch(0.32_0.05_145)] dark:text-[oklch(0.88_0.07_145)]",
  "bg-[oklch(0.93_0.035_250)] text-[oklch(0.42_0.1_250)] dark:bg-[oklch(0.32_0.05_250)] dark:text-[oklch(0.88_0.06_250)]",
];

function hash(value: string): number {
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

interface AvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** Инициалы на цветном фоне. Имя рядом всегда есть текстом, поэтому аватар скрыт от скринридеров. */
export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-display font-semibold",
        size === "sm" && "size-7 text-[11px]",
        size === "md" && "size-9 text-xs",
        size === "lg" && "size-12 text-sm",
        TONES[hash(name) % TONES.length],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

const KIND_VISUAL: Record<PropertyKind, { icon: LucideIcon; tone: string }> = {
  apartment: { icon: Building2, tone: TONES[0] },
  house: { icon: Home, tone: TONES[1] },
  commercial: { icon: Store, tone: TONES[2] },
  other: { icon: Building, tone: TONES[5] },
};

/** Плашка типа объекта: своя иконка и цвет для квартиры, дома, коммерции. */
export function KindIcon({ kind, className }: { kind: PropertyKind; className?: string }) {
  const { icon: Icon, tone } = KIND_VISUAL[kind];
  return (
    <span aria-hidden className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", tone, className)}>
      <Icon className="size-[18px]" />
    </span>
  );
}
