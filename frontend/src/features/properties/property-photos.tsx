import { ImagePlus, Trash2 } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbox } from "@/components/common/lightbox";
import { api } from "@/api/client";
import { serverMessages } from "@/api/errors";
import { useDeletePropertyPhoto, usePropertyPhotos, useUploadPropertyPhoto, type PropertyPhoto } from "@/api/listings";
import { useMediaBlob } from "@/api/portal";
import { useObjectUrl } from "@/features/media/media-parts";

const PHOTO_ACCEPT = "image/jpeg,image/png";
const PHOTO_MAX = 5 * 1024 * 1024;

function Thumb({ photo, onOpen, onDelete, deleting }: { photo: PropertyPhoto; onOpen: () => void; onDelete: () => void; deleting: boolean }) {
  const { t } = useTranslation();
  const blob = useMediaBlob(`/documents/${photo.id}/download/`);
  const url = useObjectUrl(blob.data);
  return (
    <li className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-muted">
      {url ? (
        <button type="button" onClick={onOpen} aria-label={t("listing.openFullscreen")} className="block size-full cursor-zoom-in">
          <img src={url} alt={photo.original_name} className="size-full object-cover" loading="lazy" />
        </button>
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}
      <Button
        type="button"
        size="icon"
        variant="secondary"
        className="absolute right-1.5 top-1.5 size-8 opacity-90"
        aria-label={t("listing.photos.delete")}
        loading={deleting}
        onClick={onDelete}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

/** Фото объекта: их увидят гости в поиске, если объект опубликован. */
export function PropertyPhotos({ propertyId, isListed }: { propertyId: number; isListed: boolean }) {
  const { t } = useTranslation();
  const photos = usePropertyPhotos(propertyId);
  const upload = useUploadPropertyPhoto(propertyId);
  const remove = useDeletePropertyPhoto(propertyId);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [full, setFull] = useState<number | null>(null);
  const list = photos.data ?? [];

  // те же ключи, что у миниатюр: файлы берутся из кэша
  const blobs = useQueries({
    queries: list.map((p) => ({
      queryKey: ["media-blob", `/documents/${p.id}/download/`],
      staleTime: 10 * 60_000,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        (await api.get<Blob>(`/documents/${p.id}/download/`, { responseType: "blob", signal })).data,
    })),
  });
  const [fullUrls, setFullUrls] = useState<(string | null)[]>([]);
  const blobKey = blobs.map((b) => (b.data ? b.data.size : 0)).join(",");
  useEffect(() => {
    const urls = blobs.map((b) => (b.data ? URL.createObjectURL(b.data) : null));
    setFullUrls(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blobKey]);

  const onFiles = async (files: File[]) => {
    setUploading(true);
    try {
      for (const file of files) {
        if (!["image/jpeg", "image/png"].includes(file.type)) {
          toast.error(t("listing.photos.badType", { name: file.name }));
          continue;
        }
        if (file.size > PHOTO_MAX) {
          toast.error(t("listing.photos.tooBig", { name: file.name }));
          continue;
        }
        try {
          await upload.mutateAsync(file);
        } catch (error) {
          const messages = serverMessages(error).map((m) => m.replace(/^file: /, ""));
          toast.error(messages[0] ?? t("listing.photos.failed", { name: file.name }));
        }
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{t("listing.photos.title")}</CardTitle>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept={PHOTO_ACCEPT}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void onFiles(files);
          }}
        />
        <Button type="button" variant="secondary" size="sm" loading={uploading} onClick={() => input.current?.click()}>
          <ImagePlus aria-hidden />
          {t("listing.photos.add")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {isListed ? t("listing.photos.hintListed") : t("listing.photos.hintHidden")}
        </p>
        {photos.isPending ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : list.length === 0 ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-24 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/60"
          >
            <ImagePlus className="size-4" aria-hidden />
            {t("listing.photos.empty")}
          </button>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {list.map((photo, i) => (
              <Thumb
                key={photo.id}
                photo={photo}
                onOpen={() => setFull(i)}
                deleting={remove.isPending && remove.variables === photo.id}
                onDelete={() =>
                  remove.mutate(photo.id, {
                    onSuccess: () => toast.success(t("listing.photos.deleted")),
                  })
                }
              />
            ))}
          </ul>
        )}
      </CardContent>
      <Lightbox urls={fullUrls} index={full} onIndexChange={setFull} title={t("listing.photos.title")} />
    </Card>
  );
}
