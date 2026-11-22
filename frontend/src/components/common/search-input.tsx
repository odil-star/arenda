import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}

/** Поле поиска с задержкой: не дёргаем API на каждый символ. */
export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const debounced = useDebouncedValue(draft, 350);

  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // value намеренно не в зависимостях: реагируем только на ввод пользователя
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9 pr-10 [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            onChange("");
          }}
          aria-label={t("common.clearSearch")}
          className="absolute right-0 top-0 inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground sm:size-10"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
