import { Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormAlert } from "@/components/common/form-field";
import { serverMessages } from "@/api/errors";
import { useUpdateLeaseInventory } from "@/api/hooks";
import type { Lease } from "@/api/types";
import { InventoryEditor, parseInventory } from "./inventory-editor";

/** Что входит в аренду: список для арендодателя; жилец видит его в своём кабинете. Меняется в любой момент. */
export function InventoryCard({ lease }: { lease: Lease }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const items = parseInventory(lease.inventory);
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("leases.inventory.field")}</h3>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> {items.length ? t("leases.details.edit") : t("leases.inventory.add")}
        </Button>
      </div>
      {items.length ? (
        <ul className="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
          {items.map((i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-muted-foreground">•</span>
              {i}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("leases.inventory.empty")}</p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <EditDialog lease={lease} onDone={() => setOpen(false)} />}
      </Dialog>
    </div>
  );
}

function EditDialog({ lease, onDone }: { lease: Lease; onDone: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateLeaseInventory();
  const [value, setValue] = useState(lease.inventory ?? "");
  const [errors, setErrors] = useState<string[]>([]);

  const save = async () => {
    setErrors([]);
    try {
      await update.mutateAsync({ id: lease.id, inventory: parseInventory(value).join("\n") });
      toast.success(t("leases.inventory.saved"));
      onDone();
    } catch (error) {
      setErrors(serverMessages(error));
    }
  };

  return (
    <DialogContent
      title={t("leases.inventory.field")}
      description={t("leases.inventory.hint")}
      footer={
        <>
          <Button variant="secondary" onClick={onDone} disabled={update.isPending}>{t("common.cancel")}</Button>
          <Button onClick={() => void save()} loading={update.isPending}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormAlert messages={errors} />
        <InventoryEditor value={value} onChange={setValue} />
      </div>
    </DialogContent>
  );
}
