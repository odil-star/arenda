import { Mail, Send as SendIcon, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, Textarea } from "@/components/ui/input";
import { FormAlert, FormField } from "@/components/common/form-field";
import { SearchInput } from "@/components/common/search-input";
import { EmptyState } from "@/components/common/states";
import {
  adminMessagesApi, adminUsersApi, useSendAdminMessage, type AdminChannel, type AdminMessage,
} from "@/api/admin";
import { serverMessages } from "@/api/errors";
import { useFormat } from "@/lib/format";
import { useUrlState } from "@/lib/hooks";

type Audience = "all" | "selected";

function Recipients({
  selected, onToggle,
}: {
  selected: Map<number, string>;
  onToggle: (id: number, email: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const list = adminUsersApi.useList({ page: 1, search, is_active: "true" });
  const rows = list.data?.results ?? [];

  return (
    <div className="space-y-2">
      <SearchInput value={search} onChange={setSearch} placeholder={t("admin.messages.pickSearch")} />
      <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {rows.length === 0 && !list.isPending && (
          <li className="px-3 py-3 text-sm text-muted-foreground">{t("admin.messages.pickEmpty")}</li>
        )}
        {rows.map((u) => (
          <li key={u.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={selected.has(u.id)}
                onChange={() => onToggle(u.id, u.email)}
              />
              <span className="min-w-0 truncate">{u.email}</span>
            </label>
          </li>
        ))}
      </ul>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t("admin.messages.selectedCount", { count: selected.size })}</span>
          {[...selected].map(([id, email]) => (
            <button
              key={id}
              type="button"
              onClick={() => onToggle(id, email)}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs text-accent-foreground hover:bg-accent/70"
            >
              {email}
              <X className="size-3" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function History() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = adminMessagesApi.useList({ page: 1 });
  const rows = query.data?.results ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.messages.history")}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState illustration="search" title={t("admin.messages.historyEmpty")} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((m: AdminMessage) => (
              <li key={m.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                <p className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{m.subject}</span>
                  <span className="text-xs text-muted-foreground">{fmt.date(m.created_at)}</span>
                </p>
                <p className="line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">{m.body}</p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge>{m.audience === "all" ? t("admin.messages.allShort") : t("admin.messages.selectedShort")}</Badge>
                  {t("admin.messages.recipients", { count: m.recipients_count })} ·{" "}
                  {t("admin.messages.result", { email: m.email_sent, telegram: m.telegram_sent, failed: m.failed })}
                  {m.sender_email && ` · ${t("admin.messages.by")}: ${m.sender_email}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminMessagesTab() {
  const { t } = useTranslation();
  const { values } = useUrlState(["to"] as const);
  const preselected = Number(values.to) || undefined;
  const preUser = adminUsersApi.useOne(preselected);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>(preselected ? "selected" : "all");
  const [picked, setPicked] = useState<Map<number, string> | null>(null); // null — список не менялся вручную
  const [channels, setChannels] = useState<AdminChannel[]>(["email"]);
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const create = useSendAdminMessage();

  // получатель, выбранный кнопкой «Написать» в списке арендодателей
  const preEmail = preUser.data?.email;
  const effective: Map<number, string> =
    picked ?? (preselected && preEmail ? new Map([[preselected, preEmail]]) : new Map());

  const toggle = (id: number, email: string) => {
    const next = new Map(effective);
    if (next.has(id)) next.delete(id);
    else next.set(id, email);
    setPicked(next);
  };

  const toggleChannel = (c: AdminChannel) =>
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const problem = !subject.trim() || !body.trim()
    ? "required"
    : channels.length === 0
      ? t("admin.messages.noChannel")
      : audience === "selected" && effective.size === 0
        ? t("admin.messages.noRecipients")
        : null;

  const send = async () => {
    try {
      await create.mutateAsync({
        subject: subject.trim(),
        body: body.trim(),
        audience,
        user_ids: audience === "selected" ? [...effective.keys()] : [],
        channels,
      });
      toast.success(t("admin.messages.sent"));
      setSubject("");
      setBody("");
      setErrors([]);
      setConfirm(false);
    } catch (error) {
      setConfirm(false);
      setErrors(serverMessages(error).length ? serverMessages(error) : [t("admin.messages.failed")]);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>{t("admin.messages.compose")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormAlert messages={errors} />
          <FormField label={t("admin.messages.audience")}>
            {() => (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("admin.messages.audience")}>
                {(["all", "selected"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={audience === a}
                    onClick={() => setAudience(a)}
                    className={
                      "min-h-10 rounded-lg border px-3 text-sm transition-colors " +
                      (audience === a ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-muted")
                    }
                  >
                    {a === "all" ? t("admin.messages.audienceAll") : t("admin.messages.audienceSelected")}
                  </button>
                ))}
              </div>
            )}
          </FormField>
          {audience === "selected" && <Recipients selected={effective} onToggle={toggle} />}
          <FormField label={t("admin.messages.subject")}>
            {(c) => <Input {...c} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />}
          </FormField>
          <FormField label={t("admin.messages.body")}>
            {(c) => <Textarea {...c} rows={6} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />}
          </FormField>
          <FormField label={t("admin.messages.channels")} hint={channels.includes("telegram") ? t("admin.messages.telegramHint") : undefined}>
            {() => (
              <div className="flex flex-wrap gap-4">
                {(["email", "telegram"] as const).map((c) => (
                  <label key={c} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={channels.includes(c)}
                      onChange={() => toggleChannel(c)}
                    />
                    {c === "email" ? <Mail className="size-4" aria-hidden /> : <SendIcon className="size-4" aria-hidden />}
                    {t(`admin.messages.${c}`)}
                  </label>
                ))}
              </div>
            )}
          </FormField>
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <Button disabled={problem !== null} onClick={() => setConfirm(true)}>
              <SendIcon aria-hidden />
              {t("admin.messages.send")}
            </Button>
            {problem && problem !== "required" && <p className="text-xs text-muted-foreground">{problem}</p>}
          </div>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <History />
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("admin.messages.confirmTitle")}
        description={
          audience === "all"
            ? t("admin.messages.confirmTextAll")
            : t("admin.messages.confirmTextSelected", { count: effective.size })
        }
        confirmLabel={t("admin.messages.send")}
        destructive={false}
        loading={create.isPending}
        onConfirm={() => void send()}
      />
    </div>
  );
}
