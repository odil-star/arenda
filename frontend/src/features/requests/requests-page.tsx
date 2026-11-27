import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { serverMessages } from "@/api/errors";
import {
  METER_KINDS, useLandlordLeaseRequests, useLandlordMeters, useRepairs, useResolveLeaseRequest, useSetRepairStatus,
  type LeaseRequest, type LeaseRequestStatus, type Repair, type RepairStatus,
} from "@/api/requests";
import { RepairStatusBadge } from "@/features/cabinet/services-tab";
import { RequestPhoto } from "@/features/cabinet/request-parts";
import { useFormat } from "@/lib/format";

const REPAIR_STATUSES: readonly RepairStatus[] = ["new", "in_progress", "done", "rejected"];
const REQUEST_TONE: Record<LeaseRequestStatus, BadgeTone> = { pending: "info", accepted: "success", declined: "danger", cancelled: "neutral" };

function RepairDialog({ repair, onClose }: { repair: Repair | null; onClose: () => void }) {
  const { t } = useTranslation();
  const set = useSetRepairStatus();
  const [status, setStatus] = useState<RepairStatus>(repair?.status ?? "new");
  const [comment, setComment] = useState(repair?.landlord_comment ?? "");

  const save = async () => {
    if (!repair) return;
    try {
      await set.mutateAsync({ id: repair.id, status, comment: comment.trim() });
      toast.success(t("requests.saved"));
      onClose();
    } catch (e) {
      toast.error(serverMessages(e)[0] ?? t("errors.actionFailed"));
    }
  };

  return (
    <Dialog open={repair !== null} onOpenChange={(o) => !o && !set.isPending && onClose()}>
      <DialogContent
        title={repair?.title ?? ""}
        description={repair ? `${repair.tenant_name} · ${repair.property_name}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={set.isPending}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void save()} loading={set.isPending}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            aria-label={t("common.status")}
            value={status}
            onValueChange={setStatus}
            options={REPAIR_STATUSES.map((s) => ({ value: s, label: t(`services.repairStatus.${s}`) }))}
          />
          <Textarea
            aria-label={t("requests.comment")}
            placeholder={t("requests.commentPlaceholder")}
            rows={3}
            maxLength={255}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RepairsList() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [filter, setFilter] = useState<RepairStatus | "all">("new");
  const query = useRepairs(filter === "all" ? undefined : filter);
  const [editing, setEditing] = useState<Repair | null>(null);
  const options = [
    ...REPAIR_STATUSES.map((s) => ({ value: s, label: t(`services.repairStatus.${s}`) })),
    { value: "all" as const, label: t("common.all") },
  ];
  return (
    <div className="space-y-4">
      <div className="w-56">
        <Select aria-label={t("common.status")} value={filter} onValueChange={setFilter} options={options} />
      </div>
      {query.isPending ? (
        <ListSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : query.data.length === 0 ? (
        <EmptyState illustration="search" title={t("requests.repairsEmpty")} description={t("requests.repairsEmptyText")} />
      ) : (
        <ul className="space-y-3">
          {query.data.map((r) => (
            <li key={r.id}>
              <Card className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {r.tenant_name} · {r.property_name} · {fmt.date(r.created_at.slice(0, 10))}
                    </p>
                  </div>
                  <RepairStatusBadge status={r.status} />
                </div>
                {r.description && <p className="whitespace-pre-wrap break-words text-sm">{r.description}</p>}
                {r.has_photo && <RequestPhoto path={`/repairs/${r.id}/photo/`} alt={r.title} />}
                {r.landlord_comment && <p className="rounded-lg bg-muted p-2.5 text-sm">{r.landlord_comment}</p>}
                <Button variant="secondary" size="sm" onClick={() => setEditing(r)}>
                  {t("requests.respond")}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <RepairDialog key={editing?.id ?? "none"} repair={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function ResolveDialog({ item, accept, onClose }: { item: LeaseRequest | null; accept: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const resolve = useResolveLeaseRequest();
  const [comment, setComment] = useState("");
  const send = async () => {
    if (!item) return;
    try {
      await resolve.mutateAsync({ id: item.id, accept, comment: comment.trim() });
      toast.success(t("requests.saved"));
      onClose();
    } catch (e) {
      toast.error(serverMessages(e)[0] ?? t("errors.actionFailed"));
    }
  };
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && !resolve.isPending && onClose()}>
      <DialogContent
        title={accept ? t("requests.accept") : t("requests.decline")}
        description={accept ? t("requests.acceptHint") : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={resolve.isPending}>
              {t("common.cancel")}
            </Button>
            <Button variant={accept ? "primary" : "danger"} onClick={() => void send()} loading={resolve.isPending}>
              {accept ? t("requests.accept") : t("requests.decline")}
            </Button>
          </>
        }
      >
        <Input
          aria-label={t("requests.comment")}
          placeholder={t("requests.commentPlaceholder")}
          maxLength={255}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </DialogContent>
    </Dialog>
  );
}

function LeaseRequestsList() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [filter, setFilter] = useState<LeaseRequestStatus | "all">("pending");
  const query = useLandlordLeaseRequests(filter === "all" ? undefined : filter);
  const [target, setTarget] = useState<{ item: LeaseRequest; accept: boolean } | null>(null);
  const options = [
    ...(["pending", "accepted", "declined", "cancelled"] as const).map((s) => ({ value: s, label: t(`cabinet.leaseReq.status.${s}`) })),
    { value: "all" as const, label: t("common.all") },
  ];
  return (
    <div className="space-y-4">
      <div className="w-56">
        <Select aria-label={t("common.status")} value={filter} onValueChange={setFilter} options={options} />
      </div>
      {query.isPending ? (
        <ListSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : query.data.length === 0 ? (
        <EmptyState illustration="search" title={t("requests.leaseEmpty")} description={t("requests.leaseEmptyText")} />
      ) : (
        <ul className="space-y-3">
          {query.data.map((r) => (
            <li key={r.id}>
              <Card className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {r.kind === "extend"
                        ? t("cabinet.leaseReq.extendLine", { count: r.months ?? 0 })
                        : t("cabinet.leaseReq.leaveLine", { date: fmt.date(r.move_out_date) })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {r.tenant_name} · {r.property_name} · {fmt.date(r.created_at.slice(0, 10))}
                    </p>
                  </div>
                  <Badge tone={REQUEST_TONE[r.status]}>{t(`cabinet.leaseReq.status.${r.status}`)}</Badge>
                </div>
                {r.comment && <p className="whitespace-pre-wrap break-words text-sm">{r.comment}</p>}
                {r.landlord_comment && <p className="rounded-lg bg-muted p-2.5 text-sm">{r.landlord_comment}</p>}
                {r.status === "pending" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setTarget({ item: r, accept: true })}>
                      {t("requests.accept")}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setTarget({ item: r, accept: false })}>
                      {t("requests.decline")}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ResolveDialog key={`${target?.item.id}-${target?.accept}`} item={target?.item ?? null} accept={target?.accept ?? true} onClose={() => setTarget(null)} />
    </div>
  );
}

function MetersList() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const query = useLandlordMeters();
  if (query.isPending) return <ListSkeleton rows={3} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  if (query.data.length === 0) return <EmptyState illustration="search" title={t("requests.metersEmpty")} description={t("requests.metersEmptyText")} />;
  return (
    <ul className="space-y-3">
      {query.data.map((m) => (
        <li key={m.id}>
          <Card className="space-y-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {t(`services.meter.${METER_KINDS.includes(m.kind) ? m.kind : "electricity"}`)}: <span className="tabular-nums">{fmt.number(m.value)}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {m.tenant_name} · {m.property_name} · {fmt.month(m.period)}
                </p>
              </div>
            </div>
            {m.has_photo && <RequestPhoto path={`/tenant-meter-readings/${m.id}/photo/`} alt={t(`services.meter.${m.kind}`)} />}
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function RequestsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("requests.title")} description={t("requests.description")} />
      <Tabs defaultValue="repairs" className="space-y-4">
        <TabsList aria-label={t("requests.title")}>
          <TabsTrigger value="repairs">{t("requests.tabRepairs")}</TabsTrigger>
          <TabsTrigger value="lease">{t("requests.tabLease")}</TabsTrigger>
          <TabsTrigger value="meters">{t("requests.tabMeters")}</TabsTrigger>
        </TabsList>
        <TabsContent value="repairs">
          <RepairsList />
        </TabsContent>
        <TabsContent value="lease">
          <LeaseRequestsList />
        </TabsContent>
        <TabsContent value="meters">
          <MetersList />
        </TabsContent>
      </Tabs>
    </>
  );
}
