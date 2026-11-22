import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormAlert, FormField } from "@/components/common/form-field";
import { Brand } from "@/components/layout/brand";
import { AuthHero } from "./auth-hero";
import { LanguageSwitcher, ThemeSwitcher } from "@/components/layout/preferences";
import { applyServerErrors, errorKind } from "@/api/errors";
import { useLogin, useRegister } from "@/api/hooks";
import type { TokenPair } from "@/api/types";
import { msg, optionalText } from "@/lib/validation";
import { useAuth } from "./auth-context";
import type { FromState } from "./guards";

function makeSchema(isRegister: boolean) {
  return z
    .object({
      email: isRegister
        ? z.string().trim().min(1, msg("validation.required")).email(msg("validation.email"))
        : z.string().trim().min(1, msg("validation.required")), // вход: допускаем и логин «admin»
      password: isRegister
        ? z.string().min(8, msg("validation.passwordShort"))
        : z.string().min(1, msg("validation.required")),
      confirm: z.string(),
      first_name: optionalText(150),
      last_name: optionalText(150),
      phone: optionalText(32),
    })
    .superRefine((v, ctx) => {
      if (!isRegister) return;
      if (!v.first_name) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["first_name"], ...msg("validation.required") });
      if (v.password !== v.confirm) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirm"], ...msg("validation.passwordMismatch") });
      }
    });
}

type AuthValues = z.infer<ReturnType<typeof makeSchema>>;
const FIELDS = ["email", "password", "first_name", "last_name", "phone"] as const;

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();
  const login = useLogin();
  const register = useRegister();
  const isRegister = mode === "register";
  const pending = login.isPending || register.isPending;
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const form = useForm<AuthValues>({
    resolver: zodResolver(makeSchema(isRegister)),
    defaultValues: { email: "", password: "", confirm: "", first_name: "", last_name: "", phone: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    setFormErrors([]);
    try {
      let pair: TokenPair;
      if (isRegister) {
        pair = await register.mutateAsync({
          email: v.email,
          password: v.password,
          first_name: v.first_name,
          last_name: v.last_name,
          phone: v.phone,
        });
      } else {
        pair = await login.mutateAsync({ email: v.email, password: v.password });
      }
      signIn(pair, v.email);
      const from = (location.state as FromState | null)?.from;
      navigate(from && from !== "/login" && from !== "/login/owner" ? from : "/", { replace: true });
    } catch (error) {
      // simplejwt отвечает 401 на неверный email/пароль
      if (isAxiosError(error) && error.response?.status === 401) {
        setFormErrors([t("auth.invalidCredentials")]);
        return;
      }
      const rest = applyServerErrors(error, form.setError, FIELDS);
      const kind = errorKind(error);
      if (rest.length) setFormErrors(rest);
      else if (kind !== "validation") setFormErrors([t(`errors.${kind}.description`)]);
    }
  });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <AuthHero />

      <div className="relative flex min-h-dvh flex-col">
        {/* мягкая полоса орнамента сверху на телефоне */}
        <div aria-hidden className="ornament pointer-events-none absolute inset-x-0 top-0 h-40 bg-primary opacity-[0.12] lg:hidden" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-transparent to-background lg:hidden" />

        <header className="relative flex h-14 items-center justify-between px-4 sm:px-6">
          <Brand className="lg:invisible" />
          <div className="flex items-center gap-0.5">
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </header>

        <main className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-10 sm:items-center sm:pt-0">
          <div className="w-full max-w-sm animate-rise-in">
            <h1 className="text-[28px] font-semibold tracking-tight">{t(isRegister ? "auth.registerTitle" : "auth.loginTitle")}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t(isRegister ? "auth.registerSubtitle" : "auth.loginSubtitle")}
            </p>

            <Card className="mt-6 p-5 shadow-sm">
              <form onSubmit={onSubmit} noValidate className="space-y-4">
              <FormAlert messages={formErrors} />
              {isRegister && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField label={t("auth.firstName")} error={errors.first_name?.message}>
                    {(p) => <Input {...p} autoComplete="given-name" autoFocus {...form.register("first_name")} />}
                  </FormField>
                  <FormField label={t("auth.lastName")} error={errors.last_name?.message} optional>
                    {(p) => <Input {...p} autoComplete="family-name" {...form.register("last_name")} />}
                  </FormField>
                </div>
              )}
              <FormField label={t("auth.email")} error={errors.email?.message}>
                {(p) => (
                  <Input
                    {...p}
                    type={isRegister ? "email" : "text"}
                    inputMode={isRegister ? "email" : "text"}
                    autoComplete={isRegister ? "email" : "username"}
                    autoCapitalize="none"
                    autoFocus={!isRegister}
                    {...form.register("email")}
                  />
                )}
              </FormField>
              {isRegister && (
                <FormField label={t("auth.phone")} error={errors.phone?.message} optional>
                  {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" {...form.register("phone")} />}
                </FormField>
              )}
              <FormField
                label={t("auth.password")}
                error={errors.password?.message}
                hint={isRegister ? t("auth.passwordHint") : undefined}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    {...form.register("password")}
                  />
                )}
              </FormField>
              {isRegister && (
                <FormField label={t("auth.confirmPassword")} error={errors.confirm?.message}>
                  {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("confirm")} />}
                </FormField>
              )}
              <Button type="submit" className="w-full" loading={pending}>
                {t(isRegister ? "auth.registerAction" : "auth.loginAction")}
              </Button>
            </form>
          </Card>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            {t(isRegister ? "auth.haveAccount" : "auth.noAccount")}{" "}
            <Link to={isRegister ? "/login/owner" : "/register"} className="font-medium text-primary hover:underline">
              {t(isRegister ? "auth.loginLink" : "auth.registerLink")}
            </Link>
          </p>
          {!isRegister && (
            <p className="mt-2 text-center text-sm text-muted-foreground">
              <Link to="/login/phone" className="font-medium text-primary hover:underline">
                {t("auth.phoneLoginLink")}
              </Link>
            </p>
          )}
        </div>
      </main>
      </div>
    </div>
  );
}
