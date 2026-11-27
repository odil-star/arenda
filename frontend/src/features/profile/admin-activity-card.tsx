import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminProfile } from "@/api/admin";
import { formatDateTime, useFormat } from "@/lib/format";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}

/** Профиль сотрудника платформы: роль, входы, своя активность в журнале и в чате поддержки. */
export function AdminActivityCard() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = useAdminProfile();
  const names = t("admin.audit.names", { returnObjects: true }) as Record<string, string>;

  return (
    <section aria-labelledby="adm-h" className="space-y-3">
      <h2 id="adm-h" className="text-base font-semibold">{t("admin.me.title")}</h2>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <Card className="space-y-6 p-5">
          <dl className="space-y-3">
            <Row label={t("admin.me.role")}>{t(`admin.roles.${query.data.admin_role}`)}</Row>
            <Row label={t("admin.me.joined")}>{fmt.date(query.data.date_joined)}</Row>
            <Row label={t("admin.me.lastLogin")}>{formatDateTime(query.data.last_login)}</Row>
            <Row label={t("admin.me.lastSeen")}>
              <span className="inline-flex items-center gap-2">
                {formatDateTime(query.data.presence.last_seen)}
                <Badge tone={query.data.presence.online ? "success" : "neutral"}>
                  {t(query.data.presence.online ? "admin.me.online" : "admin.me.offline")}
                </Badge>
              </span>
            </Row>
          </dl>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t("admin.me.actions")}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t("admin.me.today")} value={query.data.activity.today} />
              <Stat label={t("admin.me.week")} value={query.data.activity.week} />
              <Stat label={t("admin.me.month")} value={query.data.activity.month} />
              <Stat label={t("admin.me.total")} value={query.data.activity.total} />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t("admin.me.support")}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t("admin.me.today")} value={query.data.support.today} />
              <Stat label={t("admin.me.month")} value={query.data.support.month} />
              <Stat label={t("admin.me.threads")} value={query.data.support.threads_month} />
              <Stat label={t("admin.me.openThreads")} value={query.data.support.open_threads} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">{t("admin.me.recent")}</h3>
              <Link to="/admin/audit" className="text-sm text-primary hover:underline">
                {t("admin.me.allAudit")}
              </Link>
            </div>
            {query.data.activity.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("admin.me.noRecent")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {query.data.activity.recent.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={e.action}>{names[e.action] ?? e.action}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {e.owner_email}
                        {e.object_type && ` · ${e.object_type}${e.object_id ? ` #${e.object_id}` : ""}`}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={e.created_at}>
                      {formatDateTime(e.created_at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
    </section>
  );
}
