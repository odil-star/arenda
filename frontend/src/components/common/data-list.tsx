import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import type { Paginated } from "@/api/types";
import { cn } from "@/lib/utils";
import { Pagination } from "./pagination";
import { ErrorState, ListSkeleton } from "./states";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right";
}

interface DataListProps<T extends { id: number }> {
  query: UseQueryResult<Paginated<T>>;
  columns: Column<T>[];
  /** Карточка для телефона */
  renderMobile: (row: T) => ReactNode;
  /** Кнопки справа (редактировать, удалить, оплатить) */
  actions?: (row: T) => ReactNode;
  rowHref?: (row: T) => string;
  empty: ReactNode;
  page: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  caption: string;
}

/**
 * Список с серверной пагинацией: на телефоне карточки, с md — таблица.
 * Сам показывает загрузку, ошибку с «Повторить» и пустое состояние.
 */
export function DataList<T extends { id: number }>({
  query,
  columns,
  renderMobile,
  actions,
  rowHref,
  empty,
  page,
  pageSize,
  onPageChange,
  caption,
}: DataListProps<T>) {
  const { data, isPending, isError, error, refetch, isRefetching, isPlaceholderData } = query;

  if (isPending) {
    return (
      <Card>
        <ListSkeleton />
      </Card>
    );
  }
  if (isError) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => void refetch()} retrying={isRefetching} />
      </Card>
    );
  }
  if (!data.results.length) return <Card>{empty}</Card>;

  return (
    <Card className={cn("overflow-hidden transition-opacity", isPlaceholderData && "opacity-60")} aria-busy={isPlaceholderData}>
      {/* Телефон */}
      <ul className="divide-y divide-border md:hidden">
        {data.results.map((row) => {
          const body = renderMobile(row);
          return (
            <li key={row.id} className="flex items-center gap-2 pr-2">
              {rowHref ? (
                <Link to={rowHref(row)} className="min-w-0 flex-1 p-4 outline-offset-[-2px] active:bg-muted">
                  {body}
                </Link>
              ) : (
                <div className="min-w-0 flex-1 p-4">{body}</div>
              )}
              {actions && <div className="flex shrink-0 items-center">{actions(row)}</div>}
            </li>
          );
        })}
      </ul>

      {/* Десктоп */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-4 py-2.5 font-medium", c.align === "right" && "text-right", c.className)}>
                  {c.header}
                </th>
              ))}
              {actions && <th scope="col" className="w-px px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.results.map((row) => (
              <tr key={row.id} className="group hover:bg-muted/50">
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-4 py-3 align-middle", c.align === "right" && "text-right tabular", c.className)}>
                    {i === 0 && rowHref ? (
                      <Link to={rowHref(row)} className="font-medium hover:underline">
                        {c.cell(row)}
                      </Link>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
                {actions && (
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end gap-1">{actions(row)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} count={data.count} pageSize={pageSize} onPageChange={onPageChange} />
    </Card>
  );
}
