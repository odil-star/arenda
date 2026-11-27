import { Camera, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MEDIA_MAX_PHOTO, useMediaBlob } from "@/api/portal";
import { useObjectUrl } from "@/features/media/media-parts";

const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

/** Выбор одного фото с превью. Ошибки размера и типа показываем сразу, не дожидаясь сервера. */
export function PhotoPicker({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useObjectUrl(file ?? undefined);

  const pick = (next: File | undefined) => {
    if (!next) return;
    if (!PHOTO_ACCEPT.split(",").includes(next.type)) return setError(t("services.photoType"));
    if (next.size > MEDIA_MAX_PHOTO) return setError(t("services.photoSize"));
    setError(null);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {file && preview ? (
        <div className="relative w-fit">
          <img src={preview} alt={file.name} className="h-28 rounded-lg border border-border object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("services.photoRemove")}
            className="absolute -right-2 -top-2 flex size-8 items-center justify-center rounded-full border border-border bg-card shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => input.current?.click()}>
          <Camera aria-hidden /> {t("services.photoAdd")}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">{t("services.photoKeep")}</p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Миниатюра фото заявки или показания (файл за авторизацией — грузим как blob). Нажатие открывает фото целиком. */
export function RequestPhoto({ path, alt }: { path: string; alt: string }) {
  const blob = useMediaBlob(path);
  const url = useObjectUrl(blob.data);
  if (!url) return blob.isError ? null : <Skeleton className="h-20 w-28 rounded-lg" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block w-fit rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <img src={url} alt={alt} className="h-20 rounded-lg border border-border object-cover" loading="lazy" />
    </a>
  );
}
