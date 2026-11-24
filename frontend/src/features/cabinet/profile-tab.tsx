import { Bell, GraduationCap, KeyRound, Languages, LogOut, Palette, Send, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Avatar } from "@/components/common/avatar";
import { FormAlert, FormField } from "@/components/common/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorKind, serverMessages } from "@/api/errors";
import { useSetTenantPassword, useTenantTelegramCode, useTenantTelegramUnlink, useUpdateTenantProfile, type TenantMe } from "@/api/portal";
import { useAuth } from "@/features/auth/auth-context";
import { DeviceSettings } from "@/features/profile/device-settings";
import { TelegramCard } from "@/features/profile/telegram-card";
import { asLanguage } from "@/lib/format";
import { useTheme } from "@/lib/theme-context";
import { cn } from "@/lib/utils";
import { Disclosure } from "./cabinet-ui";

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-9 truncate rounded-md px-1.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProfileTab({ me, name, onTour }: { me: TenantMe | undefined; name: string; onTour: () => void }) {
  const { t, i18n } = useTranslation();
  const { signOut } = useAuth();
  const { theme, setTheme } = useTheme();

  if (!me) return <Skeleton className="h-60 w-full" />;

  return (
    <>
      <Card className="flex items-center gap-3 rounded-2xl p-4">
        <Avatar name={name || "?"} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{name}</p>
          {me.phone && <p className="text-sm tabular-nums text-muted-foreground">{me.phone}</p>}
          {me.email && <p className="truncate text-xs text-muted-foreground">{me.email}</p>}
        </div>
      </Card>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <Disclosure icon={<UserRound />} title={t("cabinet.contacts")}>
          <ContactsForm key={`${me.first_name}|${me.last_name}|${me.phone}`} me={me} />
        </Disclosure>
        <Disclosure icon={<KeyRound />} title={t("cabinet.passwordTitle")} value={t(me.has_password ? "cabinet.passwordIsSet" : "cabinet.passwordNotSet")}>
          <PasswordForm key={String(me.has_password)} hasPassword={me.has_password} />
        </Disclosure>
        <Disclosure icon={<Send />} title={t("profile.telegramTitle")} value={t(me.telegram_linked ? "cabinet.telegramOn" : "cabinet.telegramOff")}>
          <TenantTelegram linked={me.telegram_linked} />
        </Disclosure>
        <Disclosure icon={<Bell />} title={t("pwa.title")}>
          <DeviceSettings />
        </Disclosure>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="space-y-2">
          <p className="flex items-center gap-3 text-sm font-medium">
            <Palette className="size-5 text-muted-foreground" aria-hidden /> {t("cabinet.appearance")}
          </p>
          <Segmented
            label={t("cabinet.appearance")}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: t("theme.light") },
              { value: "dark", label: t("theme.dark") },
              { value: "system", label: t("theme.system") },
            ]}
          />
        </div>
        <div className="space-y-2">
          <p className="flex items-center gap-3 text-sm font-medium">
            <Languages className="size-5 text-muted-foreground" aria-hidden /> {t("language.title")}
          </p>
          <Segmented
            label={t("language.title")}
            value={asLanguage(i18n.language)}
            onChange={(v) => void i18n.changeLanguage(v)}
            options={[
              { value: "ru", label: t("language.ru") },
              { value: "uz", label: t("language.uz") },
            ]}
          />
        </div>
      </div>

      <Button variant="secondary" className="w-full" onClick={onTour}>
        <GraduationCap aria-hidden /> {t("tour.label")}
      </Button>

      <Button variant="secondary" className="w-full text-danger" onClick={signOut}>
        <LogOut aria-hidden /> {t("auth.logout")}
      </Button>
    </>
  );
}

function TenantTelegram({ linked }: { linked: boolean }) {
  const code = useTenantTelegramCode();
  const unlink = useTenantTelegramUnlink();
  return (
    <TelegramCard
      bare
      linked={linked}
      requestCode={() => code.mutateAsync()}
      unlink={() => unlink.mutateAsync()}
      busy={unlink.isPending}
    />
  );
}

function ContactsForm({ me }: { me: TenantMe }) {
  const { t } = useTranslation();
  const update = useUpdateTenantProfile();
  const [first, setFirst] = useState(me.first_name);
  const [last, setLast] = useState(me.last_name);
  const [phone, setPhone] = useState(me.phone);
  const [errors, setErrors] = useState<string[]>([]);
  const dirty = first !== me.first_name || last !== me.last_name || phone !== me.phone;

  const submit = async () => {
    setErrors([]);
    try {
      await update.mutateAsync({ first_name: first.trim(), last_name: last.trim(), phone: phone.trim() });
      toast.success(t("cabinet.saved"));
    } catch (error) {
      const messages = serverMessages(error);
      setErrors(messages.length ? messages : [t(`errors.${errorKind(error)}.description`)]);
    }
  };

  return (
    <form
      noValidate
      className="space-y-4"
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
      <FormField label={t("cabinet.phone")} hint={t("cabinet.phoneHint")}>
        {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
      </FormField>
      {dirty && (
        <Button type="submit" className="w-full" loading={update.isPending}>
          {t("common.save")}
        </Button>
      )}
    </form>
  );
}

function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const { t } = useTranslation();
  const setPassword = useSetTenantPassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async () => {
    setErrors([]);
    if (!next || (hasPassword && !current)) return setErrors([t("validation.required")]);
    try {
      await setPassword.mutateAsync({ password: next, ...(hasPassword ? { current_password: current } : {}) });
      toast.success(t("cabinet.passwordSaved"));
      setCurrent("");
      setNext("");
    } catch (error) {
      const messages = serverMessages(error);
      setErrors(messages.length ? messages : [t(`errors.${errorKind(error)}.description`)]);
    }
  };

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-muted-foreground">{t(hasPassword ? "cabinet.passwordHintChange" : "cabinet.passwordHintSet")}</p>
      <FormAlert messages={errors} />
      {hasPassword && (
        <FormField label={t("cabinet.currentPassword")}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </FormField>
      )}
      <FormField label={t("cabinet.newPassword")}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
      </FormField>
      <Button type="submit" className="w-full" loading={setPassword.isPending}>
        {t(hasPassword ? "cabinet.passwordChange" : "cabinet.passwordSet")}
      </Button>
    </form>
  );
}
