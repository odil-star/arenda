import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/states";
import { useAdminSystem } from "@/api/admin";
import { formatDateTime, useFormat } from "@/lib/format";

function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0 text-right text-sm">{children}</div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="divide-y divide-border">{children}</CardContent>
    </Card>
  );
}

export function AdminSystemTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = useAdminSystem();

  if (query.isPending) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;

  const s = query.data;
  const when = (iso: string | null) => (iso ? formatDateTime(iso) : t("admin.system.never"));
  const status = (ok: boolean, okLabel: string, badLabel: string, badTone: "danger" | "warning" = "danger") =>
    ok ? <Badge tone="success">{okLabel}</Badge> : <Badge tone={badTone}>{badLabel}</Badge>;
  const configured = (ok: boolean) => status(ok, t("admin.system.configured"), t("admin.system.notConfigured"), "warning");
  const count = (n: number, tone: "danger" | "warning" = "danger") => (n > 0 ? <Badge tone={tone}>{n}</Badge> : <span>0</span>);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <Section title={t("admin.system.sections.checks")}>
          <Row label={t("admin.system.database")}>{status(s.checks.database === "ok", t("admin.system.ok"), t("admin.system.fail"))}</Row>
          <Row label={t("admin.system.cache")}>{status(s.checks.cache === "ok", t("admin.system.ok"), t("admin.system.fail"))}</Row>
        </Section>

        <Section title={t("admin.system.sections.services")}>
          <Row label={t("admin.system.email")} hint={s.services.email_real ? undefined : t("admin.system.emailConsole")}>
            {status(s.services.email_real, t("admin.system.emailSmtp"), t("admin.system.notConfigured"), "warning")}
          </Row>
          <Row label={t("admin.system.telegram")}>{configured(s.services.telegram_configured)}</Row>
          <Row label={t("admin.system.sms")}>{configured(s.services.sms_configured)}</Row>
          <Row label={t("admin.system.payme")}>{configured(s.services.payme_configured)}</Row>
          <Row label={t("admin.system.click")}>{configured(s.services.click_configured)}</Row>
        </Section>

        <Section title={t("admin.system.sections.reminders")}>
          <Row label={t("admin.system.lastSent")}>{when(s.reminders.last_sent_at)}</Row>
          <Row label={t("admin.system.sent24")}>{fmt.number(s.reminders.sent_24h)}</Row>
          <Row label={t("admin.system.failed24")}>{count(s.reminders.failed_24h)}</Row>
          <Row label={t("admin.system.stuck")}>{count(s.reminders.stuck, "warning")}</Row>
          {s.reminders.last_error && (
            <Row label={t("admin.system.lastError")}>
              <span className="text-danger">{s.reminders.last_error}</span>
            </Row>
          )}
        </Section>

        <Section title={t("admin.system.sections.jobs")}>
          <Row label={t("admin.system.celery")} hint={s.services.celery_eager ? t("admin.system.celeryEagerHint") : undefined}>
            <Badge tone={s.services.celery_eager ? "warning" : "success"}>
              {s.services.celery_eager ? t("admin.system.celeryEager") : t("admin.system.celeryQueue")}
            </Badge>
          </Row>
          <Row label={t("admin.system.expiredLeases")} hint={t("admin.system.expiredLeasesHint")}>
            {count(s.leases.expired_still_active, "warning")}
          </Row>
        </Section>

        <Section
          title={t("admin.system.sections.webhooks")}
          action={
            <Link to="/admin/webhooks" className="text-xs text-primary hover:underline">
              {t("admin.system.viewWebhooks")}
            </Link>
          }
        >
          <Row label={t("admin.system.lastPayme")}>{when(s.webhooks.last_payme_at)}</Row>
          <Row label={t("admin.system.lastClick")}>{when(s.webhooks.last_click_at)}</Row>
          <Row label={t("admin.system.failed24")}>{count(s.webhooks.failed_24h)}</Row>
        </Section>

        <Section title={t("admin.system.sections.alerts")}>
          <Row label={t("admin.system.threshold")} hint={t("admin.system.thresholdHint")}>
            {s.alerts.threshold > 0 ? s.alerts.threshold : t("admin.system.thresholdDisabled")}
          </Row>
          <Row label={t("admin.system.problem24")}>
            {s.alerts.threshold > 0 && s.alerts.problem_24h >= s.alerts.threshold ? (
              <Badge tone="danger">{s.alerts.problem_24h}</Badge>
            ) : (
              s.alerts.problem_24h
            )}
          </Row>
          <Row label={t("admin.system.lastAlert")}>{when(s.alerts.last_alert_at)}</Row>
        </Section>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("admin.system.updated")}</p>
    </>
  );
}
