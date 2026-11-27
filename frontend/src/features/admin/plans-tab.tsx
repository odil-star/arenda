import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FormAlert, FormField } from "@/components/common/form-field";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useAdminPlans, useDeletePlan, useSavePlan, type AdminPlan } from "@/api/admin";
import { serverMessages } from "@/api/errors";
import { useFormat } from "@/lib/format";
import { useAdminRole } from "./use-admin-role";

function PlanDialog({ plan, onClose }: { plan: AdminPlan | "new"; onClose: () => void }) {
  const { t } = useTranslation();
  const save = useSavePlan();
  const editing = plan === "new" ? undefined : plan;
  const [name, setName] = useState(editing?.name ?? "");
  const [limit, setLimit] = useState(editing?.max_properties != null ? String(editing.max_properties) : "");
  const [tier, setTier] = useState<AdminPlan["tier"]>(editing?.tier ?? "free");
  const [price, setPrice] = useState(editing ? String(editing.price) : "0");
  const [active, setActive] = useState(editing?.is_active ?? true);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await save.mutateAsync({
        id: editing?.id,
        input: {
          name: name.trim(),
          tier,
          max_properties: limit.trim() === "" ? null : Number(limit),
          price: Number(price) || 0,
          is_active: active,
        },
      });
      toast.success(editing ? t("admin.plans.saved") : t("admin.plans.created"));
      onClose();
    } catch (error) {
      setErrors(serverMessages(error));
    }
  };

  return (
    <DialogContent
      title={editing ? t("admin.plans.edit") : t("admin.plans.new")}
      description={t("admin.plans.note")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="plan-form" loading={save.isPending} disabled={!name.trim()}>
            {t("admin.plans.save")}
          </Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        <FormAlert messages={errors} />
        <FormField label={t("admin.plans.name")}>
          {(c) => <Input {...c} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}
        </FormField>
        <FormField label={t("admin.plans.tier")} hint={t("admin.plans.tierHint")}>
          {(c) => (
            <Select
              id={c.id}
              value={tier}
              onValueChange={(v) => setTier(v as AdminPlan["tier"])}
              options={[
                { value: "free", label: "Free" },
                { value: "prime", label: "Prime" },
                { value: "vip", label: "VIP" },
              ]}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("admin.plans.limit")} hint={t("admin.plans.limitHint")}>
            {(c) => <Input {...c} type="number" inputMode="numeric" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />}
          </FormField>
          <FormField label={t("admin.plans.price")}>
            {(c) => <Input {...c} type="number" inputMode="numeric" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />}
          </FormField>
        </div>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("admin.plans.isActive")}
        </label>
      </form>
    </DialogContent>
  );
}

export function AdminPlansTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { canWrite } = useAdminRole();
  const query = useAdminPlans();
  const remove = useDeletePlan();
  const [dialog, setDialog] = useState<AdminPlan | "new">();
  const [deleting, setDeleting] = useState<AdminPlan>();

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(t("admin.plans.deleted"));
      setDeleting(undefined);
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
      setDeleting(undefined);
    }
  };

  return (
    <>
      {canWrite && (
        <div className="mb-4 flex">
          <Button className="sm:ml-auto" onClick={() => setDialog("new")}>
            <Plus aria-hidden />
            {t("admin.plans.new")}
          </Button>
        </div>
      )}

      {query.isPending ? (
        <Skeleton className="h-32" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : query.data.length === 0 ? (
        <EmptyState illustration="search" title={t("admin.plans.empty")} description={t("admin.plans.emptyHint")} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {query.data.map((p) => (
            <Card key={p.id} className={p.is_active ? undefined : "opacity-60"}>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-display text-lg font-semibold">{p.name} <Badge tone="info">{p.tier === "vip" ? "VIP" : p.tier === "prime" ? "Prime" : "Free"}</Badge></p>
                    <p className="text-sm tabular text-muted-foreground">
                      {Number(p.price) > 0 ? fmt.money(p.price) : t("admin.plans.free")}
                    </p>
                  </div>
                  <Badge tone={p.is_active ? "success" : "neutral"}>
                    {p.is_active ? t("admin.plans.active") : t("admin.plans.disabled")}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("admin.plans.limit")}</dt>
                    <dd>{p.max_properties === null ? t("admin.plans.unlimited") : t("admin.plans.properties", { count: p.max_properties })}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("admin.plans.users")}</dt>
                    <dd className="tabular">{p.users_count}</dd>
                  </div>
                </dl>
                {canWrite && (
                  <div className="flex justify-end gap-1 border-t border-border pt-2">
                    <Button variant="ghost" size="icon" aria-label={t("admin.plans.edit")} title={t("admin.plans.edit")} onClick={() => setDialog(p)}>
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("admin.plans.delete")}
                      title={t("admin.plans.delete")}
                      disabled={p.users_count > 0}
                      onClick={() => setDeleting(p)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">{t("admin.plans.note")}</p>

      <Dialog open={dialog !== undefined} onOpenChange={(o) => !o && setDialog(undefined)}>
        {dialog !== undefined && <PlanDialog key={dialog === "new" ? "new" : dialog.id} plan={dialog} onClose={() => setDialog(undefined)} />}
      </Dialog>
      <ConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("admin.plans.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("admin.plans.deleteText")}
        confirmLabel={t("admin.plans.delete")}
        loading={remove.isPending}
        onConfirm={() => void doDelete()}
      />
    </>
  );
}
