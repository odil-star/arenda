import { CheckCircle2, Clock, Eye, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/states";
import { serverMessages } from "@/api/errors";
import {
  useConfirmReceipt, useReceiptFile, useReceipts, useRejectReceipt, type Receipt, type ReceiptStatus,
} from "@/api/portal";
import { useFormat } from "@/lib/format";

const TONE: Record<ReceiptStatus, BadgeTone> = { pending: "info", confirmed: "success", rejected: "danger" };
const ICON = { pending: Clock, confirmed: CheckCircle2, rejected: XCircle } as const;

export function ReceiptsPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [status, setStatus] = useState<ReceiptStatus | "all">("pending");
  const query = useReceipts(status === "all" ? undefined : status);
  const confirm = useConfirmReceipt();
  const reject = useRejectReceipt();
  const [viewing, setViewing] = useState<Receipt | null>(null);
  const [rejecting, setRejecting] = useState<Receipt | null>(null);

  const fail = (error: unknown) => toast.error(serverMessages(error)[0] ?? t("errors.actionFailed"));
  const onConfirm = async (r: Receipt) => {
    try {
      await confirm.mutateAsync({ id: r.id });
      toast.success(t("receipts.confirmed"));
    } catch (error) {
      fail(error);
    }
  };

  const options = [
    { value: "pending", label: t("receipts.status.pending") },
    { value: "confirmed", label: t("receipts.status.confirmed") },
    { value: "rejected", label: t("receipts.status.rejected") },
    { value: "all", label: t("common.all") },
  ];

  return (
    <>
      <PageHeader title={t("receipts.title")} description={t("receipts.description")} />
      <div className="mb-4 max-w-56">
        <Select aria-label={t("common.status")} value={status} onValueChange={(v) => setStatus(v as ReceiptStatus | "all")} options={options} />
      </div>

      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : query.data.length === 0 ? (
        <EmptyState illustration="search" title={t("receipts.emptyTitle")} description={t("receipts.emptyText")} />
      ) : (
        <ul className="space-y-3">
          {query.data.map((r) => {
            const Icon = ICON[r.status];
            return (
              <li key={r.id}>
                <Card className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{r.tenant_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {r.property_name} · {t("receipts.forDate", { date: fmt.date(r.due_date) })}
                      </p>
                    </div>
                    <Badge tone={TONE[r.status]} icon={Icon}>
                      {t(`receipts.status.${r.status}`)}
                    </Badge>
                  </div>
                  <p className="text-sm">
                    {t("receipts.claimed", { amount: fmt.money(r.amount) })}
                    <span className="text-muted-foreground">
                      {" "}· {t("receipts.paidOf", { paid: fmt.money(r.amount_paid), due: fmt.money(r.amount_due) })}
                    </span>
                  </p>
                  {r.status === "rejected" && r.reject_reason && (
                    <p className="text-sm text-danger">{t("receipts.reason", { reason: r.reject_reason })}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setViewing(r)}>
                      <Eye aria-hidden />
                      {t("receipts.view")}
                    </Button>
                    {r.status === "pending" && (
                      <>
                        <Button size="sm" loading={confirm.isPending && confirm.variables?.id === r.id} onClick={() => void onConfirm(r)}>
                          {t("receipts.confirm")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRejecting(r)}>
                          {t("receipts.reject")}
                        </Button>
                      </>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <ReceiptViewer receipt={viewing} onClose={() => setViewing(null)} />
      <RejectDialog
        receipt={rejecting}
        pending={reject.isPending}
        onClose={() => setRejecting(null)}
        onSubmit={async (reason) => {
          if (!rejecting) return;
          try {
            await reject.mutateAsync({ id: rejecting.id, reason });
            toast.success(t("receipts.rejected"));
            setRejecting(null);
          } catch (error) {
            fail(error);
          }
        }}
      />
    </>
  );
}

function ReceiptViewer({ receipt, onClose }: { receipt: Receipt | null; onClose: () => void }) {
  const { t } = useTranslation();
  const file = useReceiptFile(receipt?.id);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file.data) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file.data]);

  return (
    <Dialog open={receipt !== null} onOpenChange={(o) => !o && onClose()}>
      {receipt && (
        <DialogContent title={t("receipts.viewTitle", { name: receipt.tenant_name })} className="sm:max-w-2xl">
          {file.isPending ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : file.isError || !url ? (
            <p className="text-sm text-danger">{t("errors.actionFailed")}</p>
          ) : receipt.content_type === "application/pdf" ? (
            <iframe src={url} title={receipt.original_name} className="h-[70dvh] w-full rounded-md border border-border" />
          ) : (
            <img src={url} alt={receipt.original_name} className="mx-auto max-h-[70dvh] rounded-md" />
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

function RejectDialog({
  receipt, pending, onClose, onSubmit,
}: {
  receipt: Receipt | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [receipt?.id]);
  return (
    <Dialog open={receipt !== null} onOpenChange={(o) => !o && onClose()}>
      {receipt && (
        <DialogContent
          title={t("receipts.rejectTitle")}
          description={t("receipts.rejectHint")}
          footer={
            <>
              <Button variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" loading={pending} onClick={() => void onSubmit(reason.trim())}>
                {t("receipts.reject")}
              </Button>
            </>
          }
        >
          <Input value={reason} maxLength={255} placeholder={t("receipts.reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} aria-label={t("receipts.reasonPlaceholder")} />
        </DialogContent>
      )}
    </Dialog>
  );
}
