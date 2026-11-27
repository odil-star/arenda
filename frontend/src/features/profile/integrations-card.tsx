import { Copy, Download, KeyRound, Lock, Webhook } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormAlert, FormField } from "@/components/common/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorKind, serverMessages } from "@/api/errors";
import {
  downloadAccountingCsv, useDeleteWebhook, useIntegrations, useIssueApiKey, useRevokeApiKey, useRotateWebhookSecret,
  useSaveWebhook, useTestWebhook, type IntegrationsState,
} from "@/api/integrations";
import { copyText } from "@/lib/clipboard";
import { useFormat } from "@/lib/format";

function useErrors() {
  const { t } = useTranslation();
  const [errors, setErrors] = useState<string[]>([]);
  const fail = (error: unknown) => {
    const m = serverMessages(error);
    setErrors(m.length ? m : [t(`errors.${errorKind(error)}.description`)]);
  };
  return { errors, setErrors, fail };
}

/** Секрет виден один раз: показываем сразу после создания и просим сохранить. */
function SecretBox({ value, onClose }: { value: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3">
      <p className="text-sm font-medium">{t("integrations.secretOnce")}</p>
      <code className="block break-all rounded-md bg-card p-2 text-xs">{value}</code>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            const ok = await copyText(value);
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

function AccountingExport() {
  const { t } = useTranslation();
  const { errors, setErrors, fail } = useErrors();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (kind: "transactions" | "payments") => {
    setErrors([]);
    setBusy(kind);
    try {
      await downloadAccountingCsv(kind, { from, to });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("integrations.exportTitle")}</h3>
      <p className="text-sm text-muted-foreground">{t("integrations.exportHint")}</p>
      <FormAlert messages={errors} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("integrations.from")} optional>
          {(p) => <Input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </FormField>
        <FormField label={t("integrations.to")} optional>
          {(p) => <Input {...p} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
        </FormField>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={busy === "transactions"} onClick={() => void run("transactions")}>
          <Download aria-hidden /> {t("integrations.exportTransactions")}
        </Button>
        <Button size="sm" variant="secondary" loading={busy === "payments"} onClick={() => void run("payments")}>
          <Download aria-hidden /> {t("integrations.exportPayments")}
        </Button>
      </div>
    </div>
  );
}

function ApiKeySection({ state }: { state: IntegrationsState }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const issue = useIssueApiKey();
  const revoke = useRevokeApiKey();
  const { errors, setErrors, fail } = useErrors();
  const [secret, setSecret] = useState<string>();
  const key = state.api_key;

  const create = async () => {
    setErrors([]);
    try {
      const data = await issue.mutateAsync();
      setSecret(data?.secret);
    } catch (error) {
      fail(error);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <KeyRound className="size-4" aria-hidden /> {t("integrations.keyTitle")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("integrations.keyHint")}</p>
      <FormAlert messages={errors} />
      {secret && <SecretBox value={secret} onClose={() => setSecret(undefined)} />}
      {key ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3 text-sm">
          <span>
            <code>{key.prefix}…</code>
            <span className="ml-2 text-muted-foreground">
              {key.last_used_at ? t("integrations.lastUsed", { date: fmt.date(key.last_used_at) }) : t("integrations.neverUsed")}
            </span>
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" loading={issue.isPending} onClick={() => void create()}>
              {t("integrations.reissue")}
            </Button>
            <Button size="sm" variant="ghost" loading={revoke.isPending} onClick={() => { setSecret(undefined); void revoke.mutateAsync().catch(fail); }}>
              {t("integrations.revoke")}
            </Button>
          </span>
        </div>
      ) : (
        <Button size="sm" loading={issue.isPending} onClick={() => void create()}>
          {t("integrations.createKey")}
        </Button>
      )}
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{`curl -H "Authorization: Api-Key <key>" \\
  "${(import.meta.env.VITE_API_URL ?? "https://your-domain").replace(/\/+$/, "")}/api/v1/transactions/?date_from=2026-01-01"`}</pre>
      <p className="text-xs text-muted-foreground">{t("integrations.endpoints")}</p>
    </div>
  );
}

function WebhookSection({ state }: { state: IntegrationsState }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const save = useSaveWebhook();
  const remove = useDeleteWebhook();
  const rotate = useRotateWebhookSecret();
  const test = useTestWebhook();
  const { errors, setErrors, fail } = useErrors();
  const hook = state.webhook;
  const [url, setUrl] = useState(hook?.url ?? "");
  const [secret, setSecret] = useState<string>();

  const submit = async (active = true) => {
    setErrors([]);
    try {
      const data = await save.mutateAsync({ url: url.trim(), is_active: active });
      if (data?.secret) setSecret(data.secret);
      toast.success(t("cabinet.saved"));
    } catch (error) {
      fail(error);
    }
  };

  const runTest = async () => {
    setErrors([]);
    try {
      const r = await test.mutateAsync();
      if (r.ok) toast.success(t("integrations.testOk", { status: r.status }));
      else setErrors([r.error ?? t("integrations.testFailed")]);
    } catch (error) {
      fail(error);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Webhook className="size-4" aria-hidden /> {t("integrations.hookTitle")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("integrations.hookHint")}</p>
      <FormAlert messages={errors} />
      {secret && <SecretBox value={secret} onClose={() => setSecret(undefined)} />}
      <FormField label={t("integrations.hookUrl")} hint={t("integrations.hookUrlHint")}>
        {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://" maxLength={500} value={url} onChange={(e) => setUrl(e.target.value)} />}
      </FormField>
      {hook && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={hook.is_active ? "success" : "warning"}>{hook.is_active ? t("integrations.hookOn") : t("integrations.hookOff")}</Badge>
          {hook.last_attempt_at && (
            <span className="text-muted-foreground">
              {t("integrations.lastAttempt", { date: fmt.date(hook.last_attempt_at), status: hook.last_error || hook.last_status || "—" })}
            </span>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={save.isPending} disabled={!url.trim() || (hook?.url === url.trim() && hook.is_active)} onClick={() => void submit(true)}>
          {hook?.is_active === false ? t("integrations.hookEnable") : t("common.save")}
        </Button>
        {hook && (
          <>
            <Button size="sm" variant="secondary" loading={test.isPending} onClick={() => void runTest()}>
              {t("integrations.hookTest")}
            </Button>
            <Button size="sm" variant="secondary" loading={rotate.isPending} onClick={() => void rotate.mutateAsync().then((d) => setSecret(d?.secret)).catch(fail)}>
              {t("integrations.hookRotate")}
            </Button>
            <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => { setUrl(""); setSecret(undefined); void remove.mutateAsync().catch(fail); }}>
              {t("integrations.hookDelete")}
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("integrations.hookVerify")}</p>
    </div>
  );
}

/** VIP: выгрузка для бухгалтерии, ключ API и webhooks. На других тарифах — закрытая карточка. */
export function IntegrationsCard({ onSeePlans }: { onSeePlans?: () => void }) {
  const { t } = useTranslation();
  const query = useIntegrations();

  return (
    <section aria-labelledby="int-h" className="space-y-2">
      <h2 id="int-h" className="flex items-center gap-2 text-base font-semibold">
        {t("integrations.title")}
        <span className="inline-flex items-center rounded-md bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">VIP</span>
      </h2>
      <Card className="space-y-5 p-5">
        {query.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : query.isError ? (
          <FormAlert messages={[t(`errors.${errorKind(query.error)}.description`)]} />
        ) : query.data.available ? (
          <>
            <AccountingExport />
            <hr className="border-border" />
            <ApiKeySection state={query.data} />
            <hr className="border-border" />
            <WebhookSection key={query.data.webhook?.url ?? "none"} state={query.data} />
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3">
            <span className="flex items-center gap-2 text-sm">
              <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {t("integrations.locked")}
            </span>
            {onSeePlans && (
              <Button size="sm" variant="secondary" onClick={onSeePlans}>
                {t("brand.seePlans")}
              </Button>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
