import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

interface StatCardProps {
  icon: LucideIcon;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  to?: string;
}

export function StatCard({ icon: Icon, label, value, hint, tone = "neutral", to }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("flex size-8 items-center justify-center rounded-lg", toneClass[tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
        {to && <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
      </div>
      <p className="mt-3 text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
      <p className="mt-0.5 break-words font-display text-lg font-semibold tracking-tight tabular sm:text-xl">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </>
  );

  return (
    <Card className={cn("relative", to && "transition-colors hover:border-input")}>
      {to?.startsWith("#") ? (
        /* якорь на этой же странице: плавно прокручиваем к разделу */
        <a
          href={to}
          onClick={(e) => {
            const target = document.getElementById(to.slice(1));
            if (!target) return;
            e.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className="block h-full rounded-xl p-4 sm:p-5"
        >
          {body}
        </a>
      ) : to ? (
        <Link to={to} className="block h-full rounded-xl p-4 sm:p-5">
          {body}
        </Link>
      ) : (
        <div className="p-4 sm:p-5">{body}</div>
      )}
    </Card>
  );
}
