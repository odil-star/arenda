import { Film, ImagePlus, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MEDIA_ACCEPT, MEDIA_MAX_FILES, MEDIA_MAX_PHOTO, MEDIA_MAX_VIDEO } from "@/api/portal";

/** Предварительная проверка на клиенте; настоящую проверку по содержимому делает сервер. */
export function useMediaFilter(existing = 0) {
  const { t } = useTranslation();
  return (files: File[]): File[] => {
    const ok: File[] = [];
    for (const f of files) {
      const video = f.type.startsWith("video/");
      if (!video && !f.type.startsWith("image/")) {
        toast.error(t("media.badType", { name: f.name }));
      } else if (f.size > (video ? MEDIA_MAX_VIDEO : MEDIA_MAX_PHOTO)) {
        toast.error(t("media.tooBig", { name: f.name }));
      } else if (existing + ok.length >= MEDIA_MAX_FILES) {
        toast.error(t("media.tooMany", { max: MEDIA_MAX_FILES }));
        break;
      } else {
        ok.push(f);
      }
    }
    return ok;
  };
}

export function AddFilesButton({
  onFiles, loading, multiple = true, variant = "secondary", label,
}: {
  onFiles: (files: File[]) => void;
  loading?: boolean;
  multiple?: boolean;
  variant?: "secondary" | "ghost" | "primary";
  label?: string;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={MEDIA_ACCEPT}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ""; // тот же файл можно выбрать повторно
          if (files.length) onFiles(files);
        }}
      />
      <Button type="button" variant={variant} size="sm" loading={loading} onClick={() => input.current?.click()}>
        <ImagePlus aria-hidden />
        {label ?? t("media.add")}
      </Button>
    </>
  );
}

function Preview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const { t } = useTranslation();
  const video = file.type.startsWith("video/");
  const url = useMemo(() => (video ? null : URL.createObjectURL(file)), [file, video]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <li className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
      {url ? (
        <img src={url} alt={file.name} className="size-full object-cover" />
      ) : (
        <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <Film className="size-7" aria-hidden />
          <span className="max-w-full truncate px-2 text-xs">{file.name}</span>
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${t("media.remove")}: ${file.name}`}
        className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}

/** Выбор фото/видео при составлении договора: файлы уходят на сервер после создания договора. */
export function MediaPicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const filter = useMediaFilter(files.length);
  return (
    <section aria-labelledby="media-picker-title" className="mt-6 space-y-3 border-t border-border pt-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="media-picker-title" className="text-[15px] font-semibold">{t("media.pickerTitle")}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("media.pickerHint")}</p>
        </div>
        {!disabled && <AddFilesButton onFiles={(f) => onChange([...files, ...filter(f)])} />}
      </div>
      {files.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {files.map((f, i) => (
            <Preview key={`${f.name}-${f.size}-${i}`} file={f} onRemove={() => onChange(files.filter((_, j) => j !== i))} />
          ))}
        </ul>
      )}
    </section>
  );
}
