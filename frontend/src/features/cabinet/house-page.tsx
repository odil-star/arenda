import { Navigate, useParams } from "react-router-dom";

/** Старый адрес «платежи дома» — теперь это вкладка «Платежи» с выбранным домом. */
export function HouseCabinetPage() {
  const { leaseId } = useParams();
  return <Navigate to={`/cabinet?tab=payments&lease=${leaseId ?? ""}`} replace />;
}
