import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

/** Prime: свой бланк договора (шапка PDF). available — позволяет ли тариф его менять. */
export interface ContractBrand {
  company_name: string;
  requisites: string;
  has_logo: boolean;
  available: boolean;
}

const KEY = ["contract-brand"] as const;

export function useContractBrand() {
  return useQuery({
    queryKey: KEY,
    queryFn: async ({ signal }) => (await api.get<ContractBrand>("/contract-brand/", { signal })).data,
  });
}

export interface ContractBrandInput {
  company_name: string;
  requisites: string;
  logo?: File | null;
  removeLogo?: boolean;
}

export function useSaveContractBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ContractBrandInput) => {
      const form = new FormData();
      form.append("company_name", input.company_name);
      form.append("requisites", input.requisites);
      if (input.logo) form.append("logo", input.logo);
      if (input.removeLogo) form.append("remove_logo", "1");
      return (await api.put<ContractBrand>("/contract-brand/", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}

export function useResetContractBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.delete("/contract-brand/");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
