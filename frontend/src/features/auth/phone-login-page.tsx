import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormAlert, FormField } from "@/components/common/form-field";
import { errorKind } from "@/api/errors";
import { usePhoneRequest, usePhoneVerify } from "@/api/portal";
import { PublicLayout } from "@/features/join/public-layout";
import { useAuth } from "./auth-context";

/** Вход жильца по SMS-коду; аккаунт привяжется к записи с тем же номером у арендодателя. */
export function PhoneLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const request = usePhoneRequest();
  const verify = usePhoneVerify();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

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
    <PublicLayout>
      <h1 className="text-[26px] font-semibold tracking-tight">{t("auth.phoneLoginTitle")}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{t("auth.phoneLoginHint")}</p>
      <Card className="mt-5 p-5 shadow-sm">
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void (sent ? submitCode() : sendCode());
          }}
        >
          <FormAlert messages={errors} />
          <FormField label={t("auth.phone")}>
            {(p) => (
              <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67"
                     value={phone} disabled={sent} autoFocus onChange={(e) => setPhone(e.target.value)} />
            )}
          </FormField>
          {sent && (
            <FormField label={t("auth.smsCode")}>
              {(p) => (
                <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
                       value={code} onChange={(e) => setCode(e.target.value)} />
              )}
            </FormField>
          )}
          <Button type="submit" className="w-full" loading={request.isPending || verify.isPending}>
            {t(sent ? "auth.loginAction" : "auth.sendCode")}
          </Button>
          {sent && (
            <Button type="button" variant="ghost" className="w-full" onClick={() => { setSent(false); setCode(""); }}>
              {t("auth.changePhone")}
            </Button>
          )}
        </form>
      </Card>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        <Link to="/login/owner" className="font-medium text-primary hover:underline">
          {t("auth.loginWithPassword")}
        </Link>
      </p>
    </PublicLayout>
  );
}
