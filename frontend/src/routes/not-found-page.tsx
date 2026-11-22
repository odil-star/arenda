import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/states";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      illustration="lost"
      title={t("errors.pageNotFound")}
      description={t("errors.pageNotFoundHint")}
      action={
        <Button asChild>
          <Link to="/">{t("nav.dashboard")}</Link>
        </Button>
      }
    />
  );
}
