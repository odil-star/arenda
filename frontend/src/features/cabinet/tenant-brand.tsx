import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Brand } from "@/components/layout/brand";
import type { TenantMe } from "@/api/portal";

/** Логотип арендодателя (VIP): картинка закрыта авторизацией, поэтому тянем blob и показываем по object URL. */
function useLogoUrl(tenantId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["tenant", "brand-logo", tenantId],
    enabled: enabled && tenantId !== undefined,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const res = await api.get<Blob>(`/tenant/brand/${tenantId}/logo/`, { responseType: "blob", signal });
      return URL.createObjectURL(res.data);
    },
  }).data;
}

/** Шапка кабинета жильца: бренд арендодателя на VIP, иначе — обычный логотип сервиса. */
export function TenantBrand({ me }: { me: TenantMe | undefined }) {
  const brand = me?.brands?.[0];
  const logo = useLogoUrl(brand?.tenant, !!brand?.has_logo);
  if (!brand || (!brand.name && !brand.has_logo)) return <Brand variant="house" />;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {logo && <img src={logo} alt="" className="h-8 max-w-[7rem] rounded-md object-contain" />}
      {brand.name && <span className="truncate font-display text-[17px] font-semibold tracking-tight">{brand.name}</span>}
    </span>
  );
}
