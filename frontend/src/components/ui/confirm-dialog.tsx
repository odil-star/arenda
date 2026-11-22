import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { contentClass, overlayClass } from "./dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  loading?: boolean;
  destructive?: boolean;
}

/** Подтверждение необратимого действия. Не закрывается, пока идёт запрос. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  loading,
  destructive = true,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlayClass} />
        <AlertDialog.Content className={cn(contentClass, "sm:max-w-md")}>
          <div className="space-y-2 px-5 pb-2 pt-5">
            <AlertDialog.Title className="text-base font-semibold tracking-tight">{title}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">{description}</AlertDialog.Description>
          </div>
          <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" disabled={loading}>
                {t("common.cancel")}
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant={destructive ? "danger" : "primary"}
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
