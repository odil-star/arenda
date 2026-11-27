import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { AdminSubNav } from "@/components/layout/admin-nav";
import { adminTabHref, type AdminTab } from "@/components/layout/nav-items";
import { useAdminNav } from "@/components/layout/use-admin-nav";
import { AdminAdminsTab } from "./admins-tab";
import { AdminAnnouncementsTab } from "./announcements-tab";
import { AdminAuditTab } from "./audit-tab";
import { AdminLandlordsTab } from "./landlords-tab";
import { AdminLeasesTab } from "./leases-tab";
import { AdminMessagesTab } from "./messages-tab";
import { AdminOverviewTab } from "./overview-tab";
import { AdminPaymentsTab } from "./payments-tab";
import { AdminPlansTab } from "./plans-tab";
import { AdminSupportTab } from "./support-tab";
import { AdminSystemTab } from "./system-tab";
import { AdminTenantsTab } from "./tenants-tab";
import { AdminWebhooksTab } from "./webhooks-tab";
import { ProfilePage } from "@/features/profile/profile-page";

export function AdminPage() {
  const { t } = useTranslation();
  const { tab, area, adminRole, areas } = useAdminNav();
  const { search } = useLocation();

  // старые ссылки /admin?tab=payments&problem=1 → /admin/payments?problem=1
  const legacy = new URLSearchParams(search);
  const legacyTab = legacy.get("tab");
  if (legacyTab) {
    legacy.delete("tab");
    const rest = legacy.toString();
    const target = areas.some((a) => a.id === legacyTab) ? adminTabHref(legacyTab as AdminTab) : "/admin";
    return <Navigate to={rest ? `${target}?${rest}` : target} replace />;
  }

  // чат занимает всю рабочую область: без заголовка страницы и плашек над ним
  if (tab === "support") {
    return (
      <>
        <h1 className="sr-only">{t(`admin.areas.${area.id}`)}</h1>
        <AdminSupportTab />
      </>
    );
  }

  // профиль админа — та же страница, что у арендодателя (свой заголовок, без плашек админки)
  if (tab === "profile") return <ProfilePage />;

  return (
    <>
      <PageHeader title={t(`admin.areas.${area.id}`)} description={t(`admin.areaHints.${area.id}`)} />
      {adminRole === "support" && (
        <p className="mb-4 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {t("admin.supportNotice")}
        </p>
      )}
      <AdminSubNav />
      {tab === "overview" && <AdminOverviewTab />}
      {tab === "landlords" && <AdminLandlordsTab />}
      {tab === "tenants" && <AdminTenantsTab />}
      {tab === "leases" && <AdminLeasesTab />}
      {tab === "payments" && <AdminPaymentsTab />}
      {tab === "plans" && <AdminPlansTab />}
      {tab === "system" && <AdminSystemTab />}
      {tab === "webhooks" && <AdminWebhooksTab />}
      {tab === "announcements" && <AdminAnnouncementsTab />}
      {tab === "audit" && <AdminAuditTab />}
      {tab === "messages" && <AdminMessagesTab />}
      {tab === "admins" && <AdminAdminsTab />}
    </>
  );
}
