import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Avatar } from "@/components/common/avatar";
import { FormAlert, FormField } from "@/components/common/form-field";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { RoleBadge } from "@/components/layout/user-card";
import { useCurrentUser } from "@/components/layout/use-current-user";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useChangePassword, useMe, useOwnerTelegramCode, useOwnerTelegramUnlink, useUpdateMe,
} from "@/api/hooks";
import { errorKind, serverMessages } from "@/api/errors";
import type { Language, Me } from "@/api/types";
import { DeviceSettings } from "./device-settings";
import { TelegramCard } from "./telegram-card";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value || "—"}</dd>
    </div>
  );
}

function PersonalForm({ me }: { me: Me }) {
  const { t } = useTranslation();
  const update = useUpdateMe();
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState(me.first_name);
  const [last, setLast] = useState(me.last_name);
  const [phone, setPhone] = useState(me.phone);
  const [passport, setPassport] = useState(me.passport_data ?? "");
  const [language, setLanguage] = useState<Language>(me.language);
  const [errors, setErrors] = useState<string[]>([]);
  const dirty =
    first !== me.first_name || last !== me.last_name || phone !== me.phone ||
    passport !== (me.passport_data ?? "") || language !== me.language;

  const submit = async () => {
    setErrors([]);
    try {
      await update.mutateAsync({
        first_name: first.trim(), last_name: last.trim(), phone: phone.trim(),
        passport_data: passport.trim(), language,
      });
      toast.success(t("cabinet.saved"));
      setEditing(false);
    } catch (error) {
      const m = serverMessages(error);
      setErrors(m.length ? m : [t(`errors.${errorKind(error)}.description`)]);
    }
  };

  const cancel = () => {
    setFirst(me.first_name);
    setLast(me.last_name);
    setPhone(me.phone);
    setPassport(me.passport_data ?? "");
    setLanguage(me.language);
    setErrors([]);
    setEditing(false);
  };

  if (!editing) {
    return (
      <section aria-labelledby="pf-h" className="space-y-2">
        <h2 id="pf-h" className="text-base font-semibold">{t("cabinet.contacts")}</h2>
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <dl className="space-y-2">
            <Row label={t("cabinet.firstName")} value={me.first_name} />
            <Row label={t("cabinet.lastName")} value={me.last_name} />
            <Row label="Email" value={me.email} />
            <Row label={t("cabinet.phone")} value={me.phone} />
            <Row label={t("profile.passport")} value={me.passport_data ?? ""} />
            <Row label={t("language.title")} value={me.language === "uz" ? "Oʻzbekcha" : "Русский"} />
          </dl>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {t("common.edit")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="pf-h" className="space-y-2">
      <h2 id="pf-h" className="text-base font-semibold">{t("cabinet.contacts")}</h2>
      <form
        noValidate
        className="space-y-4 rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormAlert messages={errors} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("cabinet.firstName")}>
            {(p) => <Input {...p} autoComplete="given-name" value={first} onChange={(e) => setFirst(e.target.value)} />}
          </FormField>
          <FormField label={t("cabinet.lastName")}>
            {(p) => <Input {...p} autoComplete="family-name" value={last} onChange={(e) => setLast(e.target.value)} />}
          </FormField>
        </div>
        <FormField label="Email" hint={t("profile.emailHint")}>
          {(p) => <Input {...p} value={me.email} readOnly disabled />}
        </FormField>
        <FormField label={t("cabinet.phone")}>
          {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
        </FormField>
        <FormField label={t("profile.passport")} optional>
          {(p) => <Input {...p} value={passport} onChange={(e) => setPassport(e.target.value)} />}
        </FormField>
        <FormField label={t("language.title")}>
          {(p) => (
            <select
              {...p}
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base sm:h-10 sm:text-[15px]"
            >
              <option value="ru">Русский</option>
              <option value="uz">Oʻzbekcha</option>
            </select>
          )}
        </FormField>
        <div className="flex gap-2">
          <Button type="submit" loading={update.isPending} disabled={!dirty}>
            {t("common.save")}
          </Button>
          <Button type="button" variant="secondary" onClick={cancel} disabled={update.isPending}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function PasswordForm() {
  const { t } = useTranslation();
  const change = useChangePassword();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async () => {
    setErrors([]);
    if (!current || !next) return setErrors([t("validation.required")]);
    if (next !== repeat) return setErrors([t("profile.passwordMismatch")]);
    try {
      await change.mutateAsync({ current_password: current, new_password: next });
      toast.success(t("cabinet.passwordSaved"));
      setCurrent("");
      setNext("");
      setRepeat("");
      setOpen(false);
    } catch (error) {
      const m = serverMessages(error);
      setErrors(m.length ? m : [t(`errors.${errorKind(error)}.description`)]);
    }
  };

  const cancel = () => {
    setCurrent("");
    setNext("");
    setRepeat("");
    setErrors([]);
    setOpen(false);
  };

  if (!open) {
    return (
      <section aria-labelledby="pw-h" className="space-y-2">
        <h2 id="pw-h" className="text-base font-semibold">{t("cabinet.passwordTitle")}</h2>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <span className="text-sm tracking-widest text-muted-foreground" aria-hidden>••••••••</span>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {t("cabinet.passwordChange")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="pw-h" className="space-y-2">
      <h2 id="pw-h" className="text-base font-semibold">{t("cabinet.passwordTitle")}</h2>
      <form
        noValidate
        className="space-y-4 rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-muted-foreground">{t("cabinet.passwordHintChange")}</p>
        <FormAlert messages={errors} />
        <FormField label={t("cabinet.currentPassword")}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </FormField>
        <FormField label={t("cabinet.newPassword")}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </FormField>
        <FormField label={t("profile.repeatPassword")}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />}
        </FormField>
        <div className="flex gap-2">
          <Button type="submit" loading={change.isPending}>
            {t("common.save")}
          </Button>
          <Button type="button" variant="secondary" onClick={cancel} disabled={change.isPending}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Профиль арендодателя и админа платформы: личные данные, пароль, Telegram. */
export function ProfilePage() {
  const { t } = useTranslation();
  const me = useMe();
  const user = useCurrentUser();
  const codeMutation = useOwnerTelegramCode();
  const unlinkMutation = useOwnerTelegramUnlink();

  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("profile.title")} />
      <div className="space-y-6">
        <Card className="flex items-center gap-3 p-4">
          <Avatar name={user.name || "?"} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            {user.role && <RoleBadge role={user.role} adminRole={user.adminRole} className="mt-1" />}
          </div>
        </Card>
        {me.data ? (
          <>
            <PersonalForm
              key={`${me.data.first_name}|${me.data.last_name}|${me.data.phone}|${me.data.passport_data}|${me.data.language}`}
              me={me.data}
            />
            <PasswordForm />
            <TelegramCard
              linked={me.data.telegram_linked}
              requestCode={() => codeMutation.mutateAsync()}
              unlink={() => unlinkMutation.mutateAsync()}
              busy={unlinkMutation.isPending}
            />
            <Card className="p-4">
              <h2 className="mb-3 text-base font-semibold">{t("pwa.title")}</h2>
              <DeviceSettings />
            </Card>
          </>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </div>
    </div>
  );
}
