import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium [&_svg]:size-3.5",
  {
    variants: {
      tone: {
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        info: "bg-info-soft text-info",
        neutral: "bg-neutral-soft text-neutral",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

interface BadgeProps {
  tone?: BadgeTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

/** Цвет никогда не единственный признак: всегда текст и иконка. */
export function Badge({ tone, icon: Icon, children, className }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)}>
      {Icon && <Icon aria-hidden />}
      {children}
    </span>
  );
}
