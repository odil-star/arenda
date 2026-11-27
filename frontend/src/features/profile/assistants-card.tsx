import { Copy, Lock, UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormAlert, FormField } from "@/components/common/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAssistants, useCreateAssistant, useDeleteAssistant, useResetAssistantPassword, useUpdateAssistant,
  type Assistant, type AssistantRole,
} from "@/api/assistants";
import { errorKind, serverMessages } from "@/api/errors";
import { copyText } from "@/lib/clipboard";
import { useFormat } from "@/lib/format";
import type { Subscription } from "@/api/types";
import { hasTier } from "./tiers";

interface Issued {
  email: string;
  password: string;
}

function Credentials({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const { t } = useTranslation();
  const text = `${issued.email}\n${issued.password}`;
  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3">
      <p className="text-sm font-medium">{t("assistants.passwordOnce")}</p>
      <div className="rounded-md bg-card p-2 text-sm">
        <p className="break-all">{issued.email}</p>
        <code className="break-all text-xs">{issued.password}</code>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            const ok = await copyText(text);
            if (ok) toast.success(t("integrations.copied"));
            else toast.error(t("integrations.copyFailed"));
          }}
        >
          <Copy aria-hidden /> {t("integrations.copy")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("integrations.savedIt")}
        </Button>
      </div>
    </div>
  );
}

function AddForm({ onIssued, onDone }: { onIssued: (i: Issued) => void; onDone: () => void }) {
  const { t } = useTranslation();
  const create = useCreateAssistant();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AssistantRole>("manager");
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    try {
      const made = await create.mutateAsync({ email: email.trim(), first_name: name.trim(), role });
      onIssued({ email: made.email, password: made.password });
      onDone();
    } catch (error) {
      const m = serverMessages(error);
      setErrors(m.length ? m : [t(`errors.${errorKind(error)}.description`)]);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="space-y-3 rounded-lg bg-muted p-3">
      <FormAlert messages={errors} />
      <FormField label={t("assistants.name")}>
        {(p) => <Input {...p} maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />}
      </FormField>
      <FormField label="Email">
        {(p) => <Input {...p} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </FormField>
      <FormField label={t("assistants.role")} hint={t(`assistants.roleHint.${role}`)}>
        {(p) => (
          <Select
            id={p.id}
            value={role}
            onValueChange={(v) => setRole(v as AssistantRole)}
            options={[
              { value: "manager", label: t("assistants.roles.manager") },
              { value: "accountant", label: t("assistants.roles.accountant") },
            ]}
          />
        )}
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={create.isPending} disabled={!email.trim() || !name.trim()}>
          {t("assistants.create")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

function Row({ item, onIssued }: { item: Assistant; onIssued: (i: Issued) => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const update = useUpdateAssistant();
  const reset = useResetAssistantPassword();
  const remove = useDeleteAssistant();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const name = [item.first_name, item.last_name].filter(Boolean).join(" ") || item.email;

  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {item.email} · {item.last_login ? t("assistants.lastLogin", { date: fmt.date(item.last_login) }) : t("assistants.neverLogin")}
          </p>
        </div>
        <Badge tone={item.is_active ? "success" : "neutral"}>{item.is_active ? t("assistants.active") : t("assistants.disabled")}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44">
          <Select
            id={`role-${item.id}`}
            value={item.role}
            onValueChange={(v) => void update.mutateAsync({ id: item.id, role: v as AssistantRole }).catch(() => toast.error(t("errors.actionFailed")))}
            options={[
              { value: "manager", label: t("assistants.roles.manager") },
              { value: "accountant", label: t("assistants.roles.accountant") },
            ]}
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={update.isPending}
          onClick={() => void update.mutateAsync({ id: item.id, is_active: !item.is_active }).catch(() => toast.error(t("errors.actionFailed")))}
        >
          {item.is_active ? t("assistants.disable") : t("assistants.enable")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={reset.isPending}
          onClick={() => void reset.mutateAsync(item.id).then((r) => onIssued({ email: r.email, password: r.password })).catch(() => toast.error(t("errors.actionFailed")))}
        >
          {t("assistants.resetPassword")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
          {t("assistants.delete")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("assistants.deleteTitle", { name })}
        description={t("assistants.deleteText")}
        confirmLabel={t("assistants.delete")}
        loading={remove.isPending}
        onConfirm={async () => {
          await remove.mutateAsync(item.id).catch(() => toast.error(t("errors.actionFailed")));
          setConfirmDelete(false);
        }}
      />
    </li>
  );
}

/** VIP: помощники владельца. На других тарифах — закрытая карточка. */
export function AssistantsCard({ subscription, onSeePlans }: { subscription?: Subscription; onSeePlans?: () => void }) {
  const { t } = useTranslation();
  const vip = hasTier(subscription, "vip");
  const query = useAssistants(vip);
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<Issued>();
  const full = query.data ? query.data.results.length >= query.data.limit : false;

  return (
    <section aria-labelledby="as-h" className="space-y-2">
      <h2 id="as-h" className="flex items-center gap-2 text-base font-semibold">
        {t("assistants.title")}
        <span className="inline-flex items-center rounded-md bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">VIP</span>
      </h2>
      <Card className="space-y-3 p-5">
        <p className="text-sm text-muted-foreground">{t("assistants.hint")}</p>
        {!vip ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3">
            <span className="flex items-center gap-2 text-sm">
              <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {t("assistants.locked")}
            </span>
            {onSeePlans && (
              <Button size="sm" variant="secondary" onClick={onSeePlans}>
                {t("brand.seePlans")}
              </Button>
            )}
          </div>
        ) : query.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : query.isError ? (
          <FormAlert messages={[t(`errors.${errorKind(query.error)}.description`)]} />
        ) : (
          <>
            {issued && <Credentials issued={issued} onClose={() => setIssued(undefined)} />}
            {query.data.results.length > 0 && (
              <ul className="space-y-2">
                {query.data.results.map((item) => (
                  <Row key={item.id} item={item} onIssued={setIssued} />
                ))}
              </ul>
            )}
            {adding ? (
              <AddForm onIssued={setIssued} onDone={() => setAdding(false)} />
            ) : (
              <Button size="sm" variant="secondary" disabled={full} onClick={() => setAdding(true)}>
                <UserPlus aria-hidden /> {full ? t("assistants.limit", { count: query.data.limit }) : t("assistants.add")}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">{t("assistants.rules")}</p>
          </>
        )}
      </Card>
    </section>
  );
}
