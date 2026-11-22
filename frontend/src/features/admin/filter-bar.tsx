import { SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  /** Поле поиска — всегда на виду */
  search: ReactNode;
  /** Дополнительные фильтры: на телефоне спрятаны за кнопкой «Фильтры» */
  children?: ReactNode;
  /** Сколько фильтров сейчас выбрано (отметка на кнопке) */
  active?: number;
  /** Действия справа (выгрузка) */
  actions?: ReactNode;
}

/**
 * Строка фильтров для списков админки.
 * Телефон: поиск + «Фильтры» + действия в одной строке, остальное раскрывается по кнопке.
 * Шире: всё в одну строку с переносом, действия прижаты вправо.
 */
export function FilterBar({ search, children, active = 0, actions }: FilterBarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2.5">
      <div className="min-w-0 flex-1 sm:max-w-sm sm:min-w-56">{search}</div>
      {children && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={t("admin.filters")}
          title={t("admin.filters")}
          className={cn(
            "relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg border transition-colors sm:hidden",
            open || active ? "border-primary/50 bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground",
          )}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          {active > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {active}
            </span>
          )}
        </button>
      )}
      {actions && <div className="order-1 flex shrink-0 gap-2 sm:order-last sm:ml-auto">{actions}</div>}
      {children && (
        <div
          className={cn(
            // телефон: блок под строкой поиска; шире — `contents`, и каждый фильтр переносится сам по себе
            "order-2 basis-full flex-col gap-2.5 sm:contents",
            open ? "flex" : "hidden",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
