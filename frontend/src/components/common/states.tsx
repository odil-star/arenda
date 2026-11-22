import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorKind } from "@/api/errors";
import { cn } from "@/lib/utils";
import { Illustration, type IllustrationName } from "./illustration";

interface EmptyStateProps {
  illustration: IllustrationName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ illustration, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center animate-rise-in", className)}>
      <Illustration name={illustration} className="mb-3" />
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}

export function ErrorState({ error, onRetry, retrying, className }: ErrorStateProps) {
  const { t } = useTranslation();
  const kind = errorKind(error);
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <Illustration name={kind === "notFound" ? "lost" : "offline"} className="mb-3" />
      <h3 className="text-base font-semibold">{t(`errors.${kind}.title`)}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t(`errors.${kind}.description`)}</p>
      <Button variant="secondary" className="mt-5" onClick={onRetry} loading={retrying}>
        {!retrying && <RotateCw aria-hidden />}
        {t("common.retry")}
      </Button>
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t("common.loading")} className="divide-y divide-border">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  );
}
