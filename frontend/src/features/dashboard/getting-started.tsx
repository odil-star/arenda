import { Building2, Check, ChevronRight, FileSignature, UserPlus, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { leasesApi, tenantsApi } from "@/api/hooks";
import type { Dashboard } from "@/api/types";
import { cn } from "@/lib/utils";

interface Step {
  key: "property" | "tenant" | "lease";
  icon: LucideIcon;
  to: string;
  done: boolean;
}

/**
 * Первые шаги для нового арендодателя: объект → арендатор → договор.
 * Пропадает, как только все три шага выполнены.
 */
export function GettingStarted({ data }: { data: Dashboard }) {
  const { t } = useTranslation();
  const tenants = tenantsApi.useList({ page_size: 1 });
  const leases = leasesApi.useList({ page_size: 1 });

  if (tenants.isPending || leases.isPending) return null;

  const steps: Step[] = [
    { key: "property", icon: Building2, to: "/properties?new=1", done: data.properties.total > 0 },
    { key: "tenant", icon: UserPlus, to: "/tenants?new=1", done: (tenants.data?.count ?? 0) > 0 },
    { key: "lease", icon: FileSignature, to: "/leases/new", done: (leases.data?.count ?? 0) > 0 },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const nextKey = steps.find((s) => !s.done)?.key;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight">{t("dashboard.start.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("dashboard.start.subtitle")}</p>
        </div>
        <span className="shrink-0 text-sm font-medium text-muted-foreground tabular">
          {doneCount} / {steps.length}
        </span>
      </div>
      <Progress value={(doneCount / steps.length) * 100} className="mt-4" aria-label={t("dashboard.start.title")} />

      <ol className="mt-4 space-y-2">
        {steps.map(({ key, icon: Icon, to, done }, i) => {
          const next = key === nextKey;
          const body = (
            <>
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  done ? "bg-success-soft text-success" : next ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium", done && "text-muted-foreground line-through")}>
                  {i + 1}. {t(`dashboard.start.${key}`)}
                </span>
                {!done && <span className="block text-xs text-muted-foreground">{t(`dashboard.start.${key}Hint`)}</span>}
              </span>
              {!done && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            </>
          );
          return (
            <li key={key}>
              {done ? (
                <div className="flex min-h-14 items-center gap-3 rounded-xl border border-border p-3">{body}</div>
              ) : (
                <Link
                  to={to}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-muted",
                    next && "border-primary/40 bg-accent hover:bg-accent/80",
                  )}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
