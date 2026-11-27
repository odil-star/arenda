import { CreditCard, Send, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/common/form-field";
import { ErrorState } from "@/components/common/states";
import {
  useAddAdminNote, useAdminOverview, useAdminPlans, useDeleteAdminNote, useSetSubscription, type AdminUser,
} from "@/api/admin";
import { serverMessages } from "@/api/errors";
import { formatDateTime, useFormat } from "@/lib/format";
import { displayName } from "./display-name";
import { useAdminRole } from "./use-admin-role";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 font-semibold">
        {title}
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

const when = (iso: string | null) => formatDateTime(iso);

/** Тариф арендодателя: название, срок оплаты, предупреждение, если срок вышел. */
export function PlanBadge({ user }: { user: AdminUser }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const plan = user.plan;
  if (!plan) return <span className="text-muted-foreground">{t("admin.landlords.noPlan")}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={plan.expired ? "warning" : "info"}>{plan.name}</Badge>
      {plan.paid_until && (
        <span className={plan.expired ? "text-xs text-warning" : "text-xs text-muted-foreground"}>
          {plan.expired ? t("admin.landlords.planExpired") : t("admin.landlords.paidUntil", { date: fmt.date(plan.paid_until) })}
        </span>
      )}
    </span>
  );
}

function SubscriptionDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t } = useTranslation();
  const plans = useAdminPlans();
  const save = useSetSubscription();
  const [plan, setPlan] = useState(user.plan ? String(user.plan.id) : "none");
  const [paidUntil, setPaidUntil] = useState(user.plan?.paid_until ?? "");
  const [note, setNote] = useState(user.plan?.note ?? "");
  const [managerName, setManagerName] = useState(user.plan?.manager_name ?? "");
  const [managerContact, setManagerContact] = useState(user.plan?.manager_contact ?? "");
  const [errors, setErrors] = useState<string[]>([]);

  const options = [
    { value: "none", label: t("admin.landlords.removePlan") },
    ...(plans.data ?? [])
      .filter((p) => p.is_active || p.id === user.plan?.id)
      .map((p) => ({ value: String(p.id), label: p.name })),
  ];

  const isVip = (plans.data ?? []).find((p) => String(p.id) === plan)?.tier === "vip";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await save.mutateAsync({
        id: user.id,
        input: {
          plan: plan === "none" ? null : Number(plan),
          paid_until: plan === "none" ? null : paidUntil || null,
          note: plan === "none" ? "" : note.trim(),
          manager_name: plan === "none" || !isVip ? "" : managerName.trim(),
          manager_contact: plan === "none" || !isVip ? "" : managerContact.trim(),
        },
      });
      toast.success(t("admin.landlords.subscriptionSaved"));
      onClose();
    } catch (error) {
      setErrors(serverMessages(error));
    }
  };

  return (
    <DialogContent
      title={t("admin.landlords.subscription")}
      description={displayName(user)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="subscription-form" loading={save.isPending}>
            {t("admin.plans.save")}
          </Button>
        </>
      }
    >
      <form id="subscription-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        <FormAlert messages={errors} />
        <FormField label={t("admin.landlords.planSelect")}>
          {(c) => <Select id={c.id} value={plan} onValueChange={setPlan} options={options} />}
        </FormField>
        {plan !== "none" && (
          <>
            <FormField label={t("admin.landlords.paidUntilLabel")} optional>
              {(c) => <Input {...c} type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} />}
            </FormField>
            <FormField label={t("admin.landlords.noteLabel")} optional>
              {(c) => <Input {...c} maxLength={255} value={note} onChange={(e) => setNote(e.target.value)} />}
            </FormField>
            {isVip && (
              <>
                <FormField label={t("admin.landlords.managerName")} optional>
                  {(c) => <Input {...c} maxLength={100} value={managerName} onChange={(e) => setManagerName(e.target.value)} />}
                </FormField>
                <FormField label={t("admin.landlords.managerContact")} hint={t("admin.landlords.managerHint")} optional>
                  {(c) => <Input {...c} maxLength={255} value={managerContact} onChange={(e) => setManagerContact(e.target.value)} />}
                </FormField>
              </>
            )}
          </>
        )}
      </form>
    </DialogContent>
  );
}

function Notes({ userId, notes }: { userId: number; notes: { id: number; author_email: string | null; text: string; created_at: string; can_delete: boolean }[] }) {
  const { t } = useTranslation();
  const add = useAddAdminNote();
  const remove = useDeleteAdminNote();
  const [text, setText] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await add.mutateAsync({ user: userId, text: text.trim() });
      setText("");
      toast.success(t("admin.landlords.noteSaved"));
    } catch (error) {
      toast.error(serverMessages(error)[0] ?? t("admin.landlords.noteFailed"));
    }
  };

  return (
    <div className="space-y-3">
      {notes.length === 0 ? (
        <p className="text-muted-foreground">{t("admin.landlords.notesEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line">{n.text}</p>
                <p className="text-xs text-muted-foreground">
                  {n.author_email ?? "—"} · {when(n.created_at)}
                </p>
              </div>
              {n.can_delete && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("admin.landlords.noteDelete")}
                  title={t("admin.landlords.noteDelete")}
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(n.id, {
                      onError: (error) => toast.error(serverMessages(error)[0] ?? t("errors.actionFailed")),
                    })
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <Textarea
          rows={2}
          maxLength={1000}
          value={text}
          placeholder={t("admin.landlords.notePlaceholder")}
          aria-label={t("admin.landlords.notesTitle")}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={!text.trim()} className="shrink-0">
          {t("admin.landlords.noteAdd")}
        </Button>
      </form>
    </div>
  );
}

export function LandlordDetails({ id, onClose }: { id?: number; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { canWrite } = useAdminRole();
  const query = useAdminOverview(id);
  const data = query.data;
  const [subscription, setSubscription] = useState(false);
  const names = t("admin.audit.names", { returnObjects: true }) as Record<string, string>;

  return (
    <Dialog open={id !== undefined} onOpenChange={(o) => !o && onClose()}>
      {id !== undefined && (
        <DialogContent
          title={data ? displayName(data.user) : t("common.loading")}
          description={data && displayName(data.user) !== data.user.email ? data.user.email : undefined}
          className="sm:max-w-2xl"
          footer={
            <Button variant="secondary" onClick={onClose}>
              {t("admin.landlords.close")}
            </Button>
          }
        >
          {query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
          ) : !data ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <div className="space-y-5 text-sm">
              <dl className="grid grid-cols-2 gap-3">
                <Field label={t("admin.landlords.joined")}>{fmt.date(data.user.date_joined)}</Field>
                <Field label={t("admin.landlords.lastLogin")}>
                  {data.user.last_login ? fmt.date(data.user.last_login) : t("admin.landlords.never")}
                </Field>
                <Field label={t("admin.landlords.tenants")}>{data.user.tenants_count}</Field>
                <Field label={t("admin.landlords.status")}>
                  {data.user.is_active ? t("admin.landlords.active") : t("admin.landlords.blockedBadge")}
                </Field>
                {data.user.phone && (
                  <Field label={t("admin.tenants.phone")}>
                    <span className="tabular">{data.user.phone}</span>
                  </Field>
                )}
                {data.user.telegram_linked && (
                  <Field label="Telegram">
                    <span className="inline-flex items-center gap-1">
                      <Send className="size-3.5" aria-hidden />
                      {t("admin.landlords.telegram")}
                    </span>
                  </Field>
                )}
              </dl>

              <Section title={t("admin.landlords.subscription")}>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <span className="space-y-0.5">
                    <PlanBadge user={data.user} />
                    {data.user.plan && (
                      <span className="block text-xs text-muted-foreground">
                        {data.user.plan.max_properties === null
                          ? t("admin.plans.unlimited")
                          : t("admin.plans.properties", { count: data.user.plan.max_properties })}
                        {data.user.plan.note && ` · ${data.user.plan.note}`}
                      </span>
                    )}
                  </span>
                  {canWrite && (
                    <Button variant="secondary" size="sm" onClick={() => setSubscription(true)}>
                      <CreditCard aria-hidden />
                      {data.user.plan ? t("admin.landlords.change") : t("admin.landlords.assign")}
                    </Button>
                  )}
                </div>
              </Section>

              <Section title={`${t("admin.landlords.properties")} · ${data.user.properties_count}`}>
                {data.properties.length === 0 ? (
                  <p className="text-muted-foreground">{t("admin.landlords.noProperties")}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {data.properties.map((p) => (
                      <li key={p.id} className="px-3 py-2">
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.address}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={t("admin.landlords.activeLeases")}>
                {data.active_leases.length === 0 ? (
                  <p className="text-muted-foreground">{t("admin.landlords.noLeases")}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {data.active_leases.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span>
                          <span className="block font-medium">{l.property}</span>
                          <span className="block text-xs text-muted-foreground">
                            {l.tenant} · {fmt.date(l.start_date)} — {fmt.date(l.end_date)}
                          </span>
                        </span>
                        <span className="tabular">{fmt.money(l.rent_amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={t("admin.landlords.paymentsTitle")}>
                {data.recent_payments.length === 0 ? (
                  <p className="text-muted-foreground">{t("admin.landlords.paymentsEmpty")}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {data.recent_payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="text-xs text-muted-foreground">
                          {when(p.performed_at)} ·{" "}
                          {p.provider === "manual" ? t("admin.payments.manual") : p.provider === "payme" ? "Payme" : "Click"}
                        </span>
                        <span className="tabular">{fmt.money(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={t("admin.landlords.activityTitle")}>
                {data.activity.length === 0 ? (
                  <p className="text-muted-foreground">{t("admin.landlords.activityEmpty")}</p>
                ) : (
                  <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {data.activity.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5">
                        <span title={a.action}>{names[a.action] ?? <code className="text-xs">{a.action}</code>}</span>
                        <span className="text-xs text-muted-foreground">
                          {a.actor_email ? `${a.actor_email} · ` : ""}
                          {when(a.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={t("admin.landlords.notesTitle")} hint={t("admin.landlords.notesHidden")}>
                <Notes userId={data.user.id} notes={data.notes} />
              </Section>

              <Dialog open={subscription} onOpenChange={setSubscription}>
                {subscription && <SubscriptionDialog user={data.user} onClose={() => setSubscription(false)} />}
              </Dialog>
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
