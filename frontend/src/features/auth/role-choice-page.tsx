import { isAxiosError } from "axios";
import { Building2, CheckCircle2, KeyRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormAlert, FormField } from "@/components/common/form-field";
import { Brand } from "@/components/layout/brand";
import { LanguageSwitcher, ThemeSwitcher } from "@/components/layout/preferences";
import { errorKind } from "@/api/errors";
import { useLogin } from "@/api/hooks";
import { usePhonePasswordLogin, usePhoneRequest, usePhoneVerify } from "@/api/portal";
import { cn } from "@/lib/utils";
import { AuthHero } from "./auth-hero";
import { PasskeyLoginButton } from "./passkey-login-button";
import { useAuth } from "./auth-context";
import type { FromState } from "./guards";

type RoleKey = "tenant" | "landlord";

const ROLES = [
  { key: "tenant", title: "auth.roleTenant", hint: "auth.roleTenantHint", icon: KeyRound },
  { key: "landlord", title: "auth.roleLandlord", hint: "auth.roleLandlordHint", icon: Building2 },
] as const;

/** Телефон → SMS-код. */
function PhoneFields() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const request = usePhoneRequest();
  const verify = usePhoneVerify();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [byPassword, setByPassword] = useState(false);
  const [password, setPassword] = useState("");
  const passwordLogin = usePhonePasswordLogin();
  const [errors, setErrors] = useState<string[]>([]);

  const submitPassword = async () => {
    setErrors([]);
    if (phone.replace(/\D/g, "").length < 9 || !password) {
      setErrors([t("validation.required")]);
      return;
    }
    try {
      const pair = await passwordLogin.mutateAsync({ phone, password });
      signIn(pair, phone);
      navigate("/cabinet", { replace: true });
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        setErrors([t("auth.invalidCredentials")]);
        return;
      }
      setErrors([t(`errors.${errorKind(error)}.description`)]);
    }
  };

  const sendCode = async () => {
    setErrors([]);
    if (phone.replace(/\D/g, "").length < 9) {
      setErrors([t("validation.phone")]);
      return;
    }
    try {
      await request.mutateAsync(phone);
      setSent(true);
      toast.success(t("auth.codeSent"));
    } catch (error) {
      const kind = errorKind(error);
      setErrors([t(kind === "throttled" ? "auth.codeThrottled" : `errors.${kind}.description`)]);
    }
  };

  const submitCode = async () => {
    setErrors([]);
    try {
      const pair = await verify.mutateAsync({ phone, code: code.trim() });
      signIn(pair, phone);
      navigate("/cabinet", { replace: true });
    } catch (error) {
      const kind = errorKind(error);
      setErrors([t(kind === "validation" ? "auth.codeInvalid" : `errors.${kind}.description`)]);
    }
  };

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void (byPassword ? submitPassword() : sent ? submitCode() : sendCode());
      }}
    >
      <FormAlert messages={errors} />
      <FormField label={t("auth.phone")}>
        {(p) => (
          <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67"
                 value={phone} disabled={sent} autoFocus onChange={(e) => setPhone(e.target.value)} />
        )}
      </FormField>
      {byPassword && (
        <FormField label={t("auth.password")}>
          {(p) => (
            <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </FormField>
      )}
      {!byPassword && sent && (
        <FormField label={t("auth.smsCode")}>
          {(p) => (
            <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
                   value={code} onChange={(e) => setCode(e.target.value)} />
          )}
        </FormField>
      )}
      <Button type="submit" className="w-full" loading={request.isPending || verify.isPending || passwordLogin.isPending}>
        {t(byPassword || sent ? "auth.loginAction" : "auth.sendCode")}
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={() => { setByPassword(!byPassword); setSent(false); setCode(""); setErrors([]); }}>
        {t(byPassword ? "auth.bySms" : "auth.byPassword")}
      </Button>
      {!byPassword && sent && (
        <Button type="button" variant="ghost" className="w-full" onClick={() => { setSent(false); setCode(""); }}>
          {t("auth.changePhone")}
        </Button>
      )}
    </form>
  );
}

/** Email + пароль (арендодатель, а также жилец, зарегистрированный по приглашению). */
function EmailFields() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async () => {
    setErrors([]);
    if (!email.trim() || !password) {
      setErrors([t("validation.required")]);
      return;
    }
    try {
      const pair = await login.mutateAsync({ email: email.trim(), password });
      signIn(pair, email.trim());
      const from = (location.state as FromState | null)?.from;
      navigate(from && !from.startsWith("/login") ? from : "/", { replace: true });
    } catch (error) {
      // simplejwt отвечает 401 на неверный email/пароль
      if (isAxiosError(error) && error.response?.status === 401) {
        setErrors([t("auth.invalidCredentials")]);
        return;
      }
      setErrors([t(`errors.${errorKind(error)}.description`)]);
    }
  };

  return (
    <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <FormAlert messages={errors} />
      <FormField label={t("auth.email")}>
        {(p) => (
          <Input {...p} type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoFocus
                 value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
      </FormField>
      <FormField label={t("auth.password")}>
        {(p) => (
          <Input {...p} type="password" autoComplete="current-password"
                 value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </FormField>
      <Button type="submit" className="w-full" loading={login.isPending}>
        {t("auth.loginAction")}
      </Button>
    </form>
  );
}

/** Жилец выбирает способ входа: телефон (SMS-код) или email и пароль. */
function TenantFields() {
  const { t } = useTranslation();
  const [method, setMethod] = useState<"phone" | "email">("phone");
  const methods = [
    { key: "phone", label: "auth.byPhone" },
    { key: "email", label: "auth.byEmail" },
  ] as const;
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t("auth.loginMethod")} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {methods.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={method === m.key}
            onClick={() => setMethod(m.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              method === m.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(m.label)}
          </button>
        ))}
      </div>
      {method === "phone" ? <PhoneFields /> : <EmailFields />}
    </div>
  );
}

/** Вход в приложение: сначала «кто вы», затем поля нужной роли на том же экране. Телефон — колонка, десктоп — ряд. */
export function RoleChoicePage() {
  const { t } = useTranslation();
  const [role, setRole] = useState<RoleKey | null>(null);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <AuthHero />
      <div className="relative flex min-h-dvh flex-col">
        <div aria-hidden className="ornament pointer-events-none absolute inset-x-0 top-0 h-40 bg-primary opacity-[0.12] lg:hidden" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-transparent to-background lg:hidden" />
        <header className="relative flex h-14 items-center justify-between px-4 sm:px-6">
          <Brand className="lg:invisible" />
          <div className="flex items-center gap-0.5">
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </header>

        <main className="relative flex flex-1 flex-col items-center px-4 pb-16 pt-6 sm:pt-12">
          <h1 className="w-full text-center text-[30px] font-semibold tracking-tight sm:text-[34px]">{t("auth.appLoginTitle")}</h1>
          <div className="my-auto w-full max-w-sm animate-rise-in py-6 sm:max-w-xl">
            <p className="text-center text-base text-muted-foreground">
              {t("auth.roleTitle")} {t("auth.roleSubtitle")}
            </p>

            <div role="radiogroup" aria-label={t("auth.roleTitle")} className="mt-5 flex flex-col gap-3 sm:flex-row">
              {ROLES.map((r) => {
                const on = role === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setRole(r.key)}
                    className={cn(
                      "group relative flex flex-1 items-center gap-4 rounded-2xl border-2 bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:items-start sm:gap-5 sm:p-6",
                      on ? "border-primary bg-primary/10 shadow-md" : "border-border",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-14 shrink-0 items-center justify-center rounded-2xl transition-colors sm:size-16",
                        on ? "bg-primary text-primary-foreground" : "bg-muted text-foreground group-hover:bg-primary/15",
                      )}
                    >
                      <r.icon className="size-7 sm:size-8" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-semibold leading-tight">{t(r.title)}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">{t(r.hint)}</span>
                    </span>
                    <CheckCircle2
                      aria-hidden
                      className={cn("absolute right-4 top-4 size-5 text-primary transition-opacity", on ? "opacity-100" : "opacity-0")}
                    />
                  </button>
                );
              })}
            </div>

            <PasskeyLoginButton />

            {role && (
              <Card key={role} className="mt-4 animate-rise-in p-5 shadow-sm">
                {role === "tenant" ? <TenantFields /> : <EmailFields />}
              </Card>
            )}

            {role === "landlord" && (
              <p className="mt-5 text-center text-sm text-muted-foreground">
                {t("auth.noAccount")}{" "}
                <Link to="/register" className="font-medium text-primary hover:underline">
                  {t("auth.registerLink")}
                </Link>
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
