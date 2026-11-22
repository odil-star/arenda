import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, Play, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaBlob, type LeaseMedia } from "@/api/portal";

/** Object URL для blob; освобождается при смене/размонтировании. */
export function useObjectUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}

export type FileUrl = (item: LeaseMedia) => string;

function Thumb({ item, fileUrl }: { item: LeaseMedia; fileUrl: FileUrl }) {
  const { t } = useTranslation();
  // видео не качаем ради превью — только значок
  const blob = useMediaBlob(fileUrl(item), item.kind === "photo");
  const url = useObjectUrl(blob.data);
  if (item.kind === "video") {
    return (
      <span className="flex size-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
        <Play className="size-8" aria-hidden />
        <span className="text-xs">{t("media.video")}</span>
      </span>
    );
  }
  if (!url) return blob.isError ? <span className="flex size-full items-center justify-center bg-muted text-xs text-danger">!</span> : <Skeleton className="size-full rounded-none" />;
  return <img src={url} alt={item.original_name} className="size-full object-cover" loading="lazy" />;
}

/** Сетка превью. Нажатие открывает просмотр; actions — кнопки под плиткой (для арендодателя). */
export function MediaGrid({
  items, fileUrl, actions,
}: {
  items: LeaseMedia[];
  fileUrl: FileUrl;
  actions?: (item: LeaseMedia) => ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item, i) => (
          <li key={item.id} className="space-y-1.5">
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`${t("media.open")}: ${item.original_name}`}
              className="block aspect-square w-full overflow-hidden rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Thumb item={item} fileUrl={fileUrl} />
            </button>
            {actions?.(item)}
          </li>
        ))}
      </ul>
      <Viewer items={items} index={open} fileUrl={fileUrl} onChange={setOpen} onClose={() => setOpen(null)} />
    </>
  );
}

/** Просмотр на весь экран: стрелки/клавиши ← → переключают, Esc закрывает, кнопка «Скачать» сохраняет оригинал. */
function Viewer({
  items, index, fileUrl, onChange, onClose,
}: {
  items: LeaseMedia[];
  index: number | null;
  fileUrl: FileUrl;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const item = index !== null ? items[index] : null;
  const blob = useMediaBlob(item ? fileUrl(item) : undefined, item !== null);
  const url = useObjectUrl(blob.data);
  const count = items.length;
  const go = (step: number) => index !== null && onChange((index + step + count) % count);

  return (
    <DialogPrimitive.Root open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none animate-fade-in"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(1);
            if (e.key === "ArrowLeft") go(-1);
          }}
        >
          <header className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-sm font-medium">{item?.original_name}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs text-white/60">
                {index !== null ? `${index + 1} / ${count}` : ""}
              </DialogPrimitive.Description>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {url && item && (
                <a
                  href={url}
                  download={item.original_name}
                  className="inline-flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium hover:bg-white/15 sm:h-10"
                >
                  <Download className="size-4" aria-hidden />
                  {t("media.download")}
                </a>
              )}
              <DialogPrimitive.Close
                aria-label={t("common.close")}
                className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-white/15 sm:size-10"
              >
                <X className="size-5" aria-hidden />
              </DialogPrimitive.Close>
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-14">
            {blob.isError ? (
              <p className="text-sm text-red-300">{t("errors.actionFailed")}</p>
            ) : !url || !item ? (
              <p className="text-sm text-white/60">{t("common.loading")}</p>
            ) : item.kind === "video" ? (
              <video src={url} controls playsInline autoPlay className="max-h-full max-w-full" />
            ) : (
              <img src={url} alt={item.original_name} className="max-h-full max-w-full object-contain" />
            )}
            {count > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label={t("media.prev")}
                  className="absolute left-1 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-white/20"
                >
                  <ChevronLeft className="size-6" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label={t("media.next")}
                  className="absolute right-1 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-white/20"
                >
                  <ChevronRight className="size-6" aria-hidden />
                </button>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
