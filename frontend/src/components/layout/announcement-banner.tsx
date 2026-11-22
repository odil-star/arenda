import { Info, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAnnouncements } from "@/api/announcements";
import { asLanguage } from "@/lib/format";
import { cn } from "@/lib/utils";

const KEY = "announcements.dismissed";

function readDismissed(): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

/** Объявления админа: баннер над содержимым, который можно скрыть (запоминается в браузере). */
export function AnnouncementBanner({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const query = useAnnouncements();
  const [dismissed, setDismissed] = useState<number[]>(readDismissed);
  const lang = asLanguage(i18n.language);

  const visible = (query.data ?? []).filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  const dismiss = (id: number) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next.slice(-50)));
    } catch {
      /* без сохранения: баннер вернётся после перезагрузки */
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {visible.map((a) => {
        const warning = a.level === "warning";
        const Icon = warning ? TriangleAlert : Info;
        return (
          <div
            key={a.id}
            role="status"
            className={cn(
              "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
              warning ? "border-warning/30 bg-warning-soft text-warning" : "border-info/30 bg-info-soft text-info",
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1 whitespace-pre-line">{lang === "uz" && a.text_uz ? a.text_uz : a.text_ru}</p>
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              aria-label={t("announcementBanner.dismiss")}
              title={t("announcementBanner.dismiss")}
              className="-mr-1 -mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-black/10"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
