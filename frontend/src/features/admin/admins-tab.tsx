import { ShieldCheck, ShieldOff, UserPlus } from "lucide-react";
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
import { Avatar } from "@/components/common/avatar";
import { FormAlert, FormField } from "@/components/common/form-field";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAdminAdmins, useCreateAdminAdmin, useRevokeAdminAdmin, type AdminAdmin,
} from "@/api/admin";
import { serverMessages } from "@/api/errors";
import { useFormat } from "@/lib/format";

const name = (a: AdminAdmin) => [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email;

function AddAdminDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const create = useCreateAdminAdmin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [role, setRole] = useState<"admin" | "support">("admin");
  const [errors, setErrors] = useState<string[]>([]);

  const close = () => {
    setEmail("");
    setPassword("");
    setFirstName("");
    setRole("admin");
    setErrors([]);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({ email: email.trim(), password, first_name: firstName.trim() || undefined, role });
      toast.success(t("admin.admins.created"));
      close();
    } catch (error) {
      setErrors(serverMessages(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      {open && (
        <DialogContent
          title={t("admin.admins.addTitle")}
          description={t("admin.admins.addText")}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" form="add-admin-form" loading={create.isPending} disabled={!email.trim() || !password}>
                {t("admin.admins.create")}
              </Button>
            </>
          }
        >
          <form id="add-admin-form" onSubmit={(e) => void submit(e)} className="space-y-4">
            <FormAlert messages={errors} />
            <FormField label={t("admin.admins.email")}>
              {(c) => <Input {...c} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
            </FormField>
            <FormField label={t("admin.admins.firstName")} optional>
              {(c) => <Input {...c} autoComplete="off" value={firstName} onChange={(e) => setFirstName(e.target.value)} />}
            </FormField>
            <FormField label={t("admin.admins.roleLabel")} hint={role === "admin" ? t("admin.admins.roleHintAdmin") : t("admin.admins.roleHintSupport")}>
              {(c) => (
                <Select
                  id={c.id}
                  value={role}
                  onValueChange={(v) => setRole(v as "admin" | "support")}
                  options={[
                    { value: "admin", label: t("admin.admins.roleAdmin") },
                    { value: "support", label: t("admin.admins.roleSupport") },
                  ]}
                />
              )}
            </FormField>
            <FormField label={t("admin.admins.password")} hint={t("admin.admins.passwordHint")}>
              {(c) => (
                <Input {...c} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
            </FormField>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function AdminAdminsTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = useAdminAdmins();
  const revoke = useRevokeAdminAdmin();
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<AdminAdmin>();

  const doRevoke = async () => {
    if (!target) return;
    try {
      await revoke.mutateAsync(target.id);
      toast.success(t("admin.admins.revoked"));
      setTarget(undefined);
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
    }
  };

  return (
    <>
      <div className="mb-4 flex">
        <Button className="sm:ml-auto" onClick={() => setAdding(true)}>
          <UserPlus aria-hidden />
          {t("admin.admins.add")}
        </Button>
      </div>

      {query.isPending ? (
        <Skeleton className="h-40" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : query.data.length === 0 ? (
        <EmptyState illustration="people" title={t("admin.admins.empty")} />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <ul className="divide-y divide-border">
              {query.data.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <Avatar name={name(a)} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{name(a)}</span>
                      <Badge tone={a.role === "admin" ? "success" : "neutral"}>{t(`admin.roles.${a.role}`)}</Badge>
                      {a.is_self && <Badge tone="info">{t("admin.admins.you")}</Badge>}
                      {!a.is_active && <Badge tone="danger">{t("admin.landlords.blockedBadge")}</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {name(a) !== a.email && `${a.email} · `}
                      {t("admin.admins.since")} {fmt.date(a.date_joined)} · {t("admin.admins.lastLogin")}:{" "}
                      {a.last_login ? fmt.date(a.last_login) : t("admin.admins.never")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={a.is_self}
                    aria-label={t("admin.admins.revoke")}
                    title={a.is_self ? undefined : t("admin.admins.revoke")}
                    onClick={() => setTarget(a)}
                  >
                    {a.is_self ? <ShieldCheck aria-hidden /> : <ShieldOff aria-hidden />}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <AddAdminDialog open={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={target !== undefined}
        onOpenChange={(o) => !o && setTarget(undefined)}
        title={t("admin.admins.revokeTitle", { email: target?.email ?? "" })}
        description={t("admin.admins.revokeText")}
        confirmLabel={t("admin.admins.revoke")}
        destructive
        loading={revoke.isPending}
        onConfirm={() => void doRevoke()}
      />
    </>
  );
}
