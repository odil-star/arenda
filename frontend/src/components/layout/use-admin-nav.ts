import { useLocation, useSearchParams } from "react-router-dom";
import { adminAreasFor, type AdminTab } from "./nav-items";
import { useCurrentUser } from "./use-current-user";

/** Текущий раздел админки (путь /admin/<раздел>) с учётом роли. */
export function useAdminNav() {
  const { adminRole } = useCurrentUser();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const areas = adminAreasFor(adminRole);
  const allTabs = areas.map((a) => a.id as string);
  const requested = pathname.split("/")[2] ?? params.get("tab") ?? "";
  const tab: AdminTab = allTabs.includes(requested) ? (requested as AdminTab) : "overview";
  const area = areas.find((a) => a.id === tab) ?? areas[0];
  return { areas, tab, area, onAdmin: pathname.startsWith("/admin"), adminRole };
}
