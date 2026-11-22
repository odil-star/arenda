import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FormAlert, FormField } from "@/components/common/form-field";
import { applyServerErrors, errorKind } from "@/api/errors";
import { useAcceptInvite, useInvitePreview, useRegisterTenant, useRole, type InvitePreview } from "@/api/portal";
import { msg } from "@/lib/validation";
import { useAuth } from "@/features/auth/auth-context";
import type { FromState } from "@/features/auth/guards";
import { PublicLayout } from "./public-layout";

const PHONE_RE = /^\+?[\d\s()-]{9,20}$/;

function makeSchema(needsProfile: boolean, withAccount: boolean) {
  return z
    .object({
      full_name: z.string().trim().max(200),
      phone: z.string().trim(),
      email: z.string().trim(),
      password: z.string(),
      confirm: z.string(),
    })
    .superRefine((v, ctx) => {
      const need = (path: keyof typeof v, ok: boolean, key: Parameters<typeof msg>[0] = "validation.required") => {
        if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], ...msg(key) });
      };
      if (needsProfile) {
        need("full_name", v.full_name.length > 0);
        need("phone", PHONE_RE.test(v.phone), v.phone ? "validation.phone" : "validation.required");
      }
      if (withAccount) {
        need("email", /^\S+@\S+\.\S+$/.test(v.email), v.email ? "validation.email" : "validation.required");
        need("password", v.password.length >= 8, "validation.passwordShort");
        need("confirm", v.password === v.confirm, "validation.passwordMismatch");
      }
    });
}

type Values = z.infer<ReturnType<typeof makeSchema>>;
const FIELDS = ["full_name", "phone", "email", "password"] as const;

export function JoinPage() {
  const { token = "" } = useParams();
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const preview = useInvitePreview(token);
  const role = useRole(isAuthenticated); // гостю роль не нужна (и /me/ вернул бы 401)

  let body;
  if (preview.isPending || (isAuthenticated && role.isPending)) {
    body = <Skeleton className="h-64 w-full" />;
  } else if (preview.isError) {
    const notFound = errorKind(preview.error) === "notFound";
    body = (
      <Card className="space-y-3 p-5 text-center">
        <h1 className="text-lg font-semibold">{t(notFound ? "join.invalidTitle" : "errors.network.title")}</h1>
        <p className="text-sm text-muted-foreground">{t(notFound ? "join.invalidText" : "errors.network.description")}</p>
        <Link to="/login" className="text-sm font-medium text-primary hover:underline">
          {t("auth.loginLink")}
        </Link>
      </Card>
    );
  } else {
    body = (
      <JoinForm
        token={token}
        preview={preview.data}
        authenticatedAs={isAuthenticated ? (role.data ?? null) : null}
      />
    );
  }
  return <PublicLayout>{body}</PublicLayout>;
}

function JoinForm({
  token,
  preview,
  authenticatedAs,
}: {
  token: string;
  preview: InvitePreview;
  authenticatedAs: "landlord" | "tenant" | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { signIn, signOut } = useAuth();
  const accept = useAcceptInvite();
  const register = useRegisterTenant();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const withAccount = authenticatedAs === null;

  const form = useForm<Values>({
    resolver: zodResolver(makeSchema(preview.needs_profile, withAccount)),
    defaultValues: { full_name: "", phone: "", email: "", password: "", confirm: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    setFormErrors([]);
    const profile = preview.needs_profile ? { full_name: v.full_name, phone: v.phone } : {};
    try {
      if (withAccount) {
        const pair = await register.mutateAsync({ token, email: v.email, password: v.password, ...profile });
        signIn(pair, v.email);
      } else {
        await accept.mutateAsync({ token, ...profile });
        await qc.invalidateQueries({ queryKey: ["tenant"] });
      }
      navigate("/cabinet", { replace: true });
    } catch (error) {
      const kind = errorKind(error);
      if (kind === "notFound") {
        setFormErrors([t("join.invalidText")]);
        return;
      }
      const rest = applyServerErrors(error, form.setError, FIELDS);
      if (rest.length) setFormErrors(rest);
      else if (kind !== "validation") setFormErrors([t(`errors.${kind}.description`)]);
    }
  });

  if (authenticatedAs === "landlord") {
    return (
      <Card className="space-y-3 p-5">
        <p className="text-sm">{t("join.landlordNotice")}</p>
        <Button variant="secondary" onClick={signOut}>
          {t("auth.logout")}
        </Button>
      </Card>
    );
  }

  const loginState: FromState = { from: `/join/${token}` };
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">{t("join.title")}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{t("join.from", { landlord: preview.landlord_name })}</p>
      {preview.property_name && <p className="text-sm font-medium">{t("join.property", { name: preview.property_name })}</p>}

      <Card className="mt-5 p-5 shadow-sm">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormAlert messages={formErrors} />
          {preview.needs_profile && (
            <>
              <FormField label={t("join.fullName")} error={errors.full_name?.message}>
                {(p) => <Input {...p} autoComplete="name" autoFocus {...form.register("full_name")} />}
              </FormField>
              <FormField label={t("auth.phone")} error={errors.phone?.message}>
                {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" {...form.register("phone")} />}
              </FormField>
            </>
          )}
          {withAccount && (
            <>
              <FormField label={t("auth.email")} error={errors.email?.message}>
                {(p) => <Input {...p} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" {...form.register("email")} />}
              </FormField>
              <FormField label={t("auth.password")} error={errors.password?.message} hint={t("auth.passwordHint")}>
                {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("password")} />}
              </FormField>
              <FormField label={t("auth.confirmPassword")} error={errors.confirm?.message}>
                {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register("confirm")} />}
              </FormField>
            </>
          )}
          <Button type="submit" className="w-full" loading={accept.isPending || register.isPending}>
            {t(withAccount ? "join.createAndAccept" : "join.accept")}
          </Button>
        </form>
      </Card>

      {withAccount && (
        <p className="mt-5 text-center text-sm text-muted-foreground">
          {t("auth.haveAccount")}{" "}
          <Link to="/login" state={loginState} className="font-medium text-primary hover:underline">
            {t("auth.loginLink")}
          </Link>
        </p>
      )}
    </>
  );
}
