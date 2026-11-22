import { Repeat2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { serverMessages } from "@/api/errors";
import {
  MEDIA_ACCEPT, useDeleteLeaseMedia, useLeaseMedia, useReplaceLeaseMedia, useUploadLeaseMedia, type LeaseMedia,
} from "@/api/portal";
import { MediaGrid } from "./media-parts";
import { AddFilesButton, useMediaFilter } from "./media-picker";

const fileUrl = (m: LeaseMedia) => `/lease-media/${m.id}/file/`;

function ReplaceButton({ item }: { item: LeaseMedia }) {
  const { t } = useTranslation();
  const replace = useReplaceLeaseMedia();
  const input = useRef<HTMLInputElement>(null);
  const filter = useMediaFilter(0);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept={MEDIA_ACCEPT}
        onChange={async (e) => {
          const [file] = filter(Array.from(e.target.files ?? []));
          e.target.value = "";
          if (!file) return;
          try {
            await replace.mutateAsync({ id: item.id, file });
            toast.success(t("media.replaced"));
          } catch (error) {
            toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
          }
        }}
      />
      <Button type="button" variant="ghost" size="sm" loading={replace.isPending} onClick={() => input.current?.click()}>
        <Repeat2 aria-hidden />
        {t("media.replace")}
      </Button>
    </>
  );
}

/** Фото и видео состояния квартиры на странице договора. Жилец получает уведомление о каждом изменении. */
export function LeaseMediaSection({ leaseId, canEdit }: { leaseId: number; canEdit: boolean }) {
  const { t } = useTranslation();
  const media = useLeaseMedia(leaseId);
  const upload = useUploadLeaseMedia();
  const remove = useDeleteLeaseMedia();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [deleting, setDeleting] = useState<LeaseMedia | null>(null);
  const filter = useMediaFilter(media.data?.length ?? 0);

  const onFiles = async (picked: File[]) => {
    const files = filter(picked);
    let ok = 0;
    for (const [i, file] of files.entries()) {
      setProgress({ done: i, total: files.length });
      try {
        await upload.mutateAsync({ leaseId, file });
        ok += 1;
      } catch (error) {
        toast.error(`${file.name}: ${serverMessages(error)[0] ?? t("errors.actionFailed")}`);
      }
    }
    setProgress(null);
    if (ok) toast.success(t("media.added", { count: ok }));
  };

  const onDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting);
      toast.success(t("media.deleted"));
      setDeleting(null);
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
    }
  };

  return (
    <section aria-labelledby="media-title">
      <CardHeader className="flex-row items-start justify-between gap-3 px-0 pb-3 sm:px-0">
        <div>
          <CardTitle id="media-title">{t("media.title")}</CardTitle>
          {canEdit && <p className="mt-1 text-sm text-muted-foreground">{t("media.hint")}</p>}
        </div>
        {canEdit && (
          <AddFilesButton
            onFiles={(f) => void onFiles(f)}
            loading={progress !== null}
            label={progress ? t("media.uploading", progress) : undefined}
          />
        )}
      </CardHeader>
      <Card>
        <CardContent>
          {media.isPending ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : media.isError ? (
            <p className="text-sm text-danger">{t("errors.actionFailed")}</p>
          ) : media.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("media.empty")}</p>
          ) : (
            <MediaGrid
              items={media.data}
              fileUrl={fileUrl}
              actions={
                canEdit
                  ? (item) => (
                      <div className="flex items-center justify-between gap-1">
                        <ReplaceButton item={item} />
                        <Button type="button" variant="ghost" size="icon" onClick={() => setDeleting(item)} aria-label={`${t("media.delete")}: ${item.original_name}`}>
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    )
                  : undefined
              }
            />
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("media.deleteTitle")}
        description={t("media.deleteText")}
        confirmLabel={t("media.delete")}
        onConfirm={() => void onDelete()}
        loading={remove.isPending}
      />
    </section>
  );
}
