import { useTranslation } from "react-i18next";
import type { SelectOption } from "@/components/ui/select";
import { PROPERTY_KINDS, type PropertyKind } from "@/api/types";

export function useKindOptions(): SelectOption<PropertyKind>[] {
  const { t } = useTranslation();
  return PROPERTY_KINDS.map((k) => ({ value: k, label: t(`properties.kind.${k}`) }));
}
