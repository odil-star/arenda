import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isCancelled, passkeysSupported, signInWithPasskey } from "@/lib/passkeys";
import { useAuth } from "./auth-context";

/** «Войти по отпечатку»: работает для жильца и арендодателя, ввод логина не нужен. */
export function PasskeyLoginButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!passkeysSupported()) return null;

  const run = async () => {
    setBusy(true);
    try {
      signIn(await signInWithPasskey(), "");
      navigate("/", { replace: true }); // охрана маршрутов сама отправит жильца в кабинет
    } catch (error) {
      if (!isCancelled(error)) toast.error(t("passkey.loginFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" variant="secondary" size="lg" className="mt-5 w-full" loading={busy} onClick={() => void run()}>
      <Fingerprint aria-hidden /> {t("passkey.login")}
    </Button>
  );
}
