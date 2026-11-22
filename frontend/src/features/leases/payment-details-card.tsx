import { Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { FormAlert, FormField } from "@/components/common/form-field";
import { serverMessages } from "@/api/errors";
import { useUpdateLeaseDetails } from "@/api/hooks";
import type { Lease } from "@/api/types";
import { PaymentDetails } from "@/features/cabinet/payment-details";

/** Реквизиты оплаты договора (карта и т.п.): показываются жильцу; меняются в любой момент. */
export function PaymentDetailsCard({ lease }: { lease: Lease }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("leases.details.title")}</h3>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> {t("leases.details.edit")}
        </Button>
      </div>
      {lease.payment_details ? (
        <PaymentDetails text={lease.payment_details} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("leases.details.empty")}</p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <EditDialog lease={lease} onDone={() => setOpen(false)} />}
      </Dialog>
    </div>
  );
}

function EditDialog({ lease, onDone }: { lease: Lease; onDone: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateLeaseDetails();
  const [value, setValue] = useState(lease.payment_details);
  const [errors, setErrors] = useState<string[]>([]);

  const save = async () => {
    setErrors([]);
    try {
      await update.mutateAsync({ id: lease.id, payment_details: value.trim() });
      toast.success(t("leases.details.saved"));
      onDone();
    } catch (error) {
      setErrors(serverMessages(error));
    }
  };

  return (
    <DialogContent
      title={t("leases.details.title")}
      description={t("leases.details.hint")}
      footer={
        <>
          <Button variant="secondary" onClick={onDone} disabled={update.isPending}>{t("common.cancel")}</Button>
          <Button onClick={() => void save()} loading={update.isPending}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormAlert messages={errors} />
        <FormField label={t("leases.details.field")} optional>
          {(p) => (
            <Textarea {...p} rows={5} maxLength={2000} value={value} onChange={(e) => setValue(e.target.value)}
              placeholder={t("leases.details.placeholder")} />
          )}
        </FormField>
      </div>
    </DialogContent>
  );
}
