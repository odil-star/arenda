import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PAGE_SIZE } from "@/lib/utils";

interface PaginationProps {
  page: number;
  count: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
}

export function Pagination({ page, count, onPageChange, pageSize = PAGE_SIZE }: PaginationProps) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (pages <= 1) return null;

  return (
    <nav aria-label={t("common.pagination")} className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
      <p className="text-sm text-muted-foreground tabular">{t("common.pageOf", { page, pages })}</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="icon" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label={t("common.prevPage")}>
          <ChevronLeft aria-hidden />
        </Button>
        <Button variant="secondary" size="icon" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label={t("common.nextPage")}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
