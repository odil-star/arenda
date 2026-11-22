import type { UseQueryResult } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pagination } from "@/components/common/pagination";
import { ErrorState, ListSkeleton } from "@/components/common/states";
import type { Paginated } from "@/api/types";
import { cn } from "@/lib/utils";

interface PickListProps<T extends { id: number }> {
  query: UseQueryResult<Paginated<T>>;
  label: string;
  selectedId: number | null;
  onSelect: (item: T) => void;
  render: (item: T) => ReactNode;
  disabledReason?: (item: T) => string | null;
  empty: ReactNode;
  page: number;
  onPageChange: (page: number) => void;
}

/** Выбор одного элемента из пагинированного списка (radiogroup со стрелками). */
export function PickList<T extends { id: number }>({
  query,
  label,
  selectedId,
  onSelect,
  render,
  disabledReason,
  empty,
  page,
  onPageChange,
}: PickListProps<T>) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  if (query.isPending) return <ListSkeleton rows={4} />;
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />;
  }
  if (!query.data.results.length) return <>{empty}</>;

  const items = query.data.results;
  const enabled = items.filter((i) => !disabledReason?.(i));
  const focusId = selectedId ?? enabled[0]?.id;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]:not([disabled])") ?? []);
    const idx = buttons.findIndex((b) => b === document.activeElement);
    const next = buttons[(idx + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  };

  return (
    <div>
      <div ref={listRef} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="space-y-2">
        {items.map((item) => {
          const reason = disabledReason?.(item) ?? null;
          const selected = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={Boolean(reason)}
              tabIndex={item.id === focusId ? 0 : -1}
              onClick={() => onSelect(item)}
              className={cn(
                "flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors",
                "hover:border-input disabled:cursor-not-allowed disabled:opacity-55",
                selected && "border-primary bg-accent/50 hover:border-primary",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border border-input",
                  selected && "border-primary bg-primary text-primary-foreground",
                )}
                aria-hidden
              >
                {selected && <Check className="size-3" />}
              </span>
              <span className="min-w-0 flex-1">{render(item)}</span>
              {reason && <span className="shrink-0 text-xs text-muted-foreground">{reason}</span>}
            </button>
          );
        })}
      </div>
      <Pagination page={page} count={query.data.count} onPageChange={onPageChange} />
      <span className="sr-only" aria-live="polite">
        {selectedId ? t("leases.wizard.selected") : ""}
      </span>
    </div>
  );
}
