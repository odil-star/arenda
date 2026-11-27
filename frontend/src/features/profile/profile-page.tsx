import { Activity, Bell, GraduationCap, Palette, Plug, Sparkles, UserRound, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Avatar } from "@/components/common/avatar";
import { FormAlert, FormField } from "@/components/common/form-field";
import { OnboardingTour } from "@/components/common/onboarding-tour";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { RoleBadge } from "@/components/layout/user-card";
import { useCurrentUser } from "@/components/layout/use-current-user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useChangePassword, useMe, useOwnerTelegramCode, useOwnerTelegramUnlink, useUpdateMe,
} from "@/api/hooks";
import { errorKind, serverMessages } from "@/api/errors";
import type { Language, Me } from "@/api/types";
import { AdminActivityCard } from "./admin-activity-card";
import { AssistantsCard } from "./assistants-card";
import { BrandCard } from "./brand-card";
import { DeviceSettings } from "./device-settings";
import { IntegrationsCard } from "./integrations-card";
import { TariffsTab } from "./tariffs-tab";
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
      <section aria-labelledby="pf-h" className="space-y-3">
        <h2 id="pf-h" className="text-base font-semibold">{t("cabinet.contacts")}</h2>
        <div className="space-y-5 rounded-xl border border-border bg-card p-5">
          <dl className="space-y-3">
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
    <section aria-labelledby="pf-h" className="space-y-3">
      <h2 id="pf-h" className="text-base font-semibold">{t("cabinet.contacts")}</h2>
      <form
        noValidate
        className="space-y-5 rounded-xl border border-border bg-card p-5"
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
      <section aria-labelledby="pw-h" className="space-y-3">
        <h2 id="pw-h" className="text-base font-semibold">{t("cabinet.passwordTitle")}</h2>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-5">
          <span className="text-sm tracking-widest text-muted-foreground" aria-hidden>••••••••</span>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {t("cabinet.passwordChange")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="pw-h" className="space-y-3">
      <h2 id="pw-h" className="text-base font-semibold">{t("cabinet.passwordTitle")}</h2>
      <form
        noValidate
        className="space-y-5 rounded-xl border border-border bg-card p-5"
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

type SectionId = "account" | "work" | "brand" | "integrations" | "assistants" | "devices" | "plan";

/** Профиль арендодателя и админа платформы: меню разделов слева, справа открыт один раздел. */
export function ProfilePage() {
  const { t } = useTranslation();
  const me = useMe();
  const user = useCurrentUser();
  const codeMutation = useOwnerTelegramCode();
  const unlinkMutation = useOwnerTelegramUnlink();
  const [tourOpen, setTourOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const showPlans = user.role === "landlord" && !user.isAdmin;

  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;

  if (me.data?.assistant) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t("profile.title")} />
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={user.name || "?"} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{me.data.email}</p>
            </div>
          </div>
          <p className="text-sm">
            <Badge tone="info">{t(`assistants.roles.${me.data.assistant.role}`)}</Badge>{" "}
            {t("assistants.profileOwner", { owner: me.data.assistant.owner_name })}
          </p>
          <p className="text-sm text-muted-foreground">{t(`assistants.roleHint.${me.data.assistant.role}`)}</p>
          <p className="text-sm text-muted-foreground">{t("assistants.profilePassword")}</p>
        </Card>
      </div>
    );
  }

  const data = me.data;
  if (!data) {
    return (
      <div>
        <PageHeader title={t("profile.title")} />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const tier = data.subscription?.tier ?? "free";
  const sections: { id: SectionId; label: string; icon: ReactNode }[] = [
    { id: "account", label: t("profile.account"), icon: <UserRound aria-hidden /> },
    ...(user.isAdmin ? [{ id: "work" as const, label: t("admin.me.title"), icon: <Activity aria-hidden /> }] : []),
    ...(showPlans
      ? [
          { id: "brand" as const, label: t("brand.title"), icon: <Palette aria-hidden /> },
          { id: "integrations" as const, label: t("integrations.title"), icon: <Plug aria-hidden /> },
          { id: "assistants" as const, label: t("assistants.title"), icon: <Users aria-hidden /> },
        ]
      : []),
    { id: "devices", label: t("pwa.title"), icon: <Bell aria-hidden /> },
    ...(showPlans ? [{ id: "plan" as const, label: t("tiers.tabPlan"), icon: <Sparkles aria-hidden /> }] : []),
  ];
  const requested = params.get("section");
  const active = sections.find((s) => s.id === requested)?.id ?? "account";
  const open = (id: SectionId) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === "account") next.delete("section");
        else next.set("section", id);
        return next;
      },
      { replace: true },
    );
  const seePlans = () => open("plan");

  const content: Record<SectionId, ReactNode> = {
    account: (
      <div className="space-y-8">
        <PersonalForm key={`${data.first_name}|${data.last_name}|${data.phone}|${data.passport_data}|${data.language}`} me={data} />
        <PasswordForm />
        <TelegramCard
          linked={data.telegram_linked}
          refresh={() => me.refetch()}
          requestCode={() => codeMutation.mutateAsync()}
          unlink={() => unlinkMutation.mutateAsync()}
          busy={unlinkMutation.isPending}
        />
      </div>
    ),
    work: <AdminActivityCard />,
    brand: <BrandCard onSeePlans={seePlans} />,
    integrations: <IntegrationsCard onSeePlans={seePlans} />,
    assistants: <AssistantsCard subscription={data.subscription} onSeePlans={seePlans} />,
    devices: (
      <section aria-labelledby="dev-h" className="space-y-3">
        <h2 id="dev-h" className="text-base font-semibold">{t("pwa.title")}</h2>
        <Card className="p-5">
          <DeviceSettings />
        </Card>
      </section>
    ),
    plan: (
      <section aria-labelledby="plan-h" className="space-y-3">
        <h2 id="plan-h" className="text-base font-semibold">{t("tiers.tabPlan")}</h2>
        <TariffsTab subscription={data.subscription} />
      </section>
    ),
  };

  const tourButton = (className: string) =>
    showPlans && (
      <Button variant="secondary" className={className} onClick={() => setTourOpen(true)}>
        <GraduationCap aria-hidden /> {t("tour.label")}
      </Button>
    );

  return (
    <div>
      <PageHeader title={t("profile.title")} />
      <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-6">
          <Card className="flex items-center gap-4 p-5">
            <Avatar name={user.name || "?"} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{user.name}</p>
              {data.email && <p className="truncate text-sm text-muted-foreground">{data.email}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {user.role && <RoleBadge role={user.role} adminRole={user.adminRole} />}
                {showPlans && (
                  <Badge tone={tier === "vip" ? "warning" : tier === "prime" ? "info" : "neutral"}>{t(`tiers.${tier}.name`)}</Badge>
                )}
              </div>
            </div>
          </Card>
          <nav
            aria-label={t("profile.title")}
            className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:rounded-xl lg:border lg:border-border lg:bg-card lg:p-2"
          >
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-current={active === s.id ? "page" : undefined}
                onClick={() => open(s.id)}
                className={cn(
                  "flex min-h-10 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors lg:border-transparent",
                  "focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4 [&_svg]:shrink-0",
                  active === s.id
                    ? "border-transparent bg-muted text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground lg:bg-transparent",
                )}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </nav>
          {tourButton("hidden w-full lg:inline-flex")}
        </aside>
        <div key={active} className={cn("min-w-0", active !== "plan" && active !== "integrations" && "max-w-3xl")}>
          {content[active]}
        </div>
      </div>
      {tourButton("mt-6 w-full lg:hidden")}
      {tourOpen && <OnboardingTour kind="landlord" open onClose={() => setTourOpen(false)} />}
    </div>
  );
}
