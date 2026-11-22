import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadExport } from "@/api/admin";
import { cn } from "@/lib/utils";

interface ExportButtonProps {
  /** Путь ресурса, например "/admin/users/" — к нему добавится `export/` */
  path: string;
  /** Имя файла без даты и расширения */
  name: string;
  /** Те же фильтры, что в списке (без страницы) */
  params?: object;
  className?: string;
}

/** Скачивает CSV того, что админ сейчас видит в списке. */
export function ExportButton({ path, name, params, className }: ExportButtonProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await downloadExport(path, name, params);
    } catch {
      toast.error(t("admin.export.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={() => void run()}
      title={t("admin.export.button")}
      className={cn("max-sm:size-11 max-sm:px-0", className)}
    >
      <Download aria-hidden />
      <span className="max-sm:sr-only">{t("admin.export.button")}</span>
    </Button>
  );
}
