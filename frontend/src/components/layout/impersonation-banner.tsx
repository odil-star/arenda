import { Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { tokens } from "@/api/tokens";

/** Полоса сверху, пока админ смотрит сервис глазами арендодателя (режим только для чтения). */
export function ImpersonationBanner() {
  const { t } = useTranslation();
  const email = tokens.impersonating;
  if (!email) return null;

  const exit = () => {
    const restored = tokens.stopImpersonation();
    window.location.assign(restored ? "/admin/landlords" : "/login");
  };

  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm font-medium text-warning">
      <span className="inline-flex items-center gap-2">
        <Eye className="size-4 shrink-0" aria-hidden />
        {t("admin.viewMode.banner", { email })}
      </span>
      <Button size="sm" variant="secondary" onClick={exit}>
        {t("admin.viewMode.exit")}
      </Button>
    </div>
  );
}
