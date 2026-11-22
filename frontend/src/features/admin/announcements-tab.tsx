import { Info, Pencil, Plus, Power, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FormAlert, FormField } from "@/components/common/form-field";
import { EmptyState, ErrorState } from "@/components/common/states";
import {
  adminAnnouncementsApi, type AdminAnnouncement, type AdminAnnouncementInput, type AnnouncementLevel,
} from "@/api/admin";
import { serverMessages } from "@/api/errors";
import { useFormat } from "@/lib/format";
import { useAdminRole } from "./use-admin-role";

const EMPTY: AdminAnnouncementInput = { text_ru: "", text_uz: "", level: "info", is_active: true };

function AnnouncementDialog({ item, onClose }: { item: AdminAnnouncement | "new" | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  const create = adminAnnouncementsApi.useCreate();
  const update = adminAnnouncementsApi.useUpdate();
  const editing = item !== undefined && item !== "new" ? item : undefined;
  const [form, setForm] = useState<AdminAnnouncementInput>(
    editing
      ? { text_ru: editing.text_ru, text_uz: editing.text_uz, level: editing.level, is_active: editing.is_active }
      : EMPTY,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const pending = create.isPending || update.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const input = { ...form, text_ru: form.text_ru.trim(), text_uz: form.text_uz.trim() };
      if (editing) await update.mutateAsync({ id: editing.id, input });
      else await create.mutateAsync(input);
      toast.success(editing ? t("admin.announcements.saved") : t("admin.announcements.created"));
      onClose();
    } catch (error) {
      const messages = serverMessages(error);
      setErrors(messages.length ? messages : [t("admin.announcements.failed")]);
    }
  };

  return (
    <DialogContent
      title={editing ? t("admin.announcements.edit") : t("admin.announcements.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="announcement-form" loading={pending} disabled={!form.text_ru.trim()}>
            {t("admin.announcements.save")}
          </Button>
        </>
      }
    >
      <form id="announcement-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        <FormAlert messages={errors} />
        <FormField label={t("admin.announcements.textRu")}>
          {(c) => (
            <Textarea {...c} rows={3} maxLength={500} value={form.text_ru} onChange={(e) => setForm({ ...form, text_ru: e.target.value })} />
          )}
        </FormField>
        <FormField label={t("admin.announcements.textUz")} hint={t("admin.announcements.textUzHint")} optional>
          {(c) => (
            <Textarea {...c} rows={3} maxLength={500} value={form.text_uz} onChange={(e) => setForm({ ...form, text_uz: e.target.value })} />
          )}
        </FormField>
        <FormField label={t("admin.announcements.level")}>
          {(c) => (
            <Select
              id={c.id}
              value={form.level}
              onValueChange={(v) => setForm({ ...form, level: v as AnnouncementLevel })}
              options={[
                { value: "info", label: t("admin.announcements.info") },
                { value: "warning", label: t("admin.announcements.warning") },
              ]}
            />
          )}
        </FormField>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          {t("admin.announcements.active")}
        </label>
      </form>
    </DialogContent>
  );
}

export function AdminAnnouncementsTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { canWrite } = useAdminRole();
  const query = adminAnnouncementsApi.useList({ page: 1 });
  const update = adminAnnouncementsApi.useUpdate();
  const remove = adminAnnouncementsApi.useRemove();
  const [dialog, setDialog] = useState<AdminAnnouncement | "new">();
  const [deleting, setDeleting] = useState<AdminAnnouncement>();

  const toggle = async (a: AdminAnnouncement) => {
    try {
      await update.mutateAsync({
        id: a.id,
        input: { text_ru: a.text_ru, text_uz: a.text_uz, level: a.level, is_active: !a.is_active },
      });
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("admin.announcements.failed"));
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(t("admin.announcements.deleted"));
      setDeleting(undefined);
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
    }
  };

  const rows = query.data?.results ?? [];

  return (
    <>
      {canWrite && (
        <div className="mb-4 flex">
          <Button className="sm:ml-auto" onClick={() => setDialog("new")}>
            <Plus aria-hidden />
            {t("admin.announcements.new")}
          </Button>
        </div>
      )}

      {query.isPending ? (
        <Skeleton className="h-32" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState illustration="search" title={t("admin.announcements.empty")} description={t("admin.announcements.emptyHint")} />
      ) : (
        <ul className="space-y-3">
          {rows.map((a) => {
            const Icon = a.level === "warning" ? TriangleAlert : Info;
            return (
              <li key={a.id}>
                <Card className={a.is_active ? undefined : "opacity-60"}>
                  <CardContent className="flex flex-wrap items-start gap-3">
                    <span
                      className={
                        "flex size-9 shrink-0 items-center justify-center rounded-lg " +
                        (a.level === "warning" ? "bg-warning-soft text-warning" : "bg-info-soft text-info")
                      }
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <Badge tone={a.is_active ? "success" : "neutral"}>
                          {a.is_active ? t("admin.announcements.active") : t("admin.announcements.inactive")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {fmt.date(a.created_at)}
                          {a.created_by_email && ` · ${t("admin.announcements.by")}: ${a.created_by_email}`}
                        </span>
                      </p>
                      <p className="whitespace-pre-line text-sm">{a.text_ru}</p>
                      {a.text_uz && <p className="whitespace-pre-line text-sm text-muted-foreground">{a.text_uz}</p>}
                    </div>
                    {canWrite && (
                      <div className="flex shrink-0 items-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={a.is_active ? t("admin.announcements.disable") : t("admin.announcements.enable")}
                          title={a.is_active ? t("admin.announcements.disable") : t("admin.announcements.enable")}
                          onClick={() => void toggle(a)}
                        >
                          <Power aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={t("admin.announcements.edit")} title={t("admin.announcements.edit")} onClick={() => setDialog(a)}>
                          <Pencil aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={t("admin.announcements.delete")} title={t("admin.announcements.delete")} onClick={() => setDeleting(a)}>
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={dialog !== undefined} onOpenChange={(o) => !o && setDialog(undefined)}>
        {dialog !== undefined && <AnnouncementDialog key={dialog === "new" ? "new" : dialog.id} item={dialog} onClose={() => setDialog(undefined)} />}
      </Dialog>
      <ConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("admin.announcements.deleteTitle")}
        description={t("admin.announcements.deleteText")}
        confirmLabel={t("admin.announcements.delete")}
        loading={remove.isPending}
        onConfirm={() => void doDelete()}
      />
    </>
  );
}
