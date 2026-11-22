import { Navigate, useParams } from "react-router-dom";

/** Старый адрес «один договор» — теперь это вкладка «Договор» с выбранным домом. */
export function ContractCabinetPage() {
  const { leaseId } = useParams();
  return <Navigate to={`/cabinet?tab=contract&lease=${leaseId ?? ""}`} replace />;
}
