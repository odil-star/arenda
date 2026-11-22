import type { Lease, Payment } from "@/api/types";

/** «Объект · Арендатор» — API платежей и договоров отдаёт имена вместе с id. */
export function Parties({ item }: { item: Pick<Payment | Lease, "property_name" | "tenant_name"> }) {
  return (
    <>
      <span className="font-medium">{item.property_name}</span>
      <span className="text-muted-foreground"> · {item.tenant_name}</span>
    </>
  );
}
