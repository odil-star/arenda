import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

interface LightboxProps {
  /** готовые адреса картинок (http или blob:) */
  urls: readonly (string | null)[];
  /** индекс открытого фото; null — закрыто */
  index: number | null;
  onIndexChange: (index: number | null) => void;
  title: string;
}

/** Просмотр фото на весь экран: стрелки, клавиши ←/→, Esc, свайп. */
export function Lightbox({ urls, index, onIndexChange, title }: LightboxProps) {
  const { t } = useTranslation();
  const open = index !== null && urls.length > 0;
  const count = urls.length;

  const go = (d: number) => {
    if (index === null || count < 2) return;
    onIndexChange((index + d + count) % count);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, count]);

  let touchX: number | null = null;
  const src = open ? urls[index] : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/95 animate-fade-in" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[60] flex items-center justify-center outline-none"
          onClick={(e) => e.target === e.currentTarget && onIndexChange(null)}
          onTouchStart={(e) => {
            touchX = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const end = e.changedTouches[0]?.clientX;
            if (touchX !== null && end !== undefined && Math.abs(end - touchX) > 50) go(end < touchX ? 1 : -1);
            touchX = null;
          }}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {src && <img src={src} alt={title} className="h-dvh w-screen select-none object-contain" draggable={false} />}

          <DialogPrimitive.Close
            aria-label={t("common.close")}
            className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white"
          >
            <X className="size-6" aria-hidden />
          </DialogPrimitive.Close>

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t("listing.prevPhoto")}
                className="absolute left-3 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white"
              >
                <ChevronLeft className="size-7" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t("listing.nextPhoto")}
                className="absolute right-3 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white"
              >
                <ChevronRight className="size-7" aria-hidden />
              </button>
              <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-sm text-white tabular backdrop-blur">
                {(index ?? 0) + 1} / {count}
              </span>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
