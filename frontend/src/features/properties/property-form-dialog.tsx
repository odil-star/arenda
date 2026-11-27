import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/common/form-field";
import { applyServerErrors } from "@/api/errors";
import { propertiesApi } from "@/api/hooks";
import { PROPERTY_KINDS, type Property, type PropertyInput } from "@/api/types";
import { decimalString, integerString, msg, optionalText, requiredText } from "@/lib/validation";
import { useKindOptions } from "./use-kind-options";

const schema = z
  .object({
    name: requiredText(200),
    address: requiredText(255),
    kind: z.enum(PROPERTY_KINDS),
    area_m2: decimalString({ required: false, positive: true }),
    rooms: integerString({ required: false, positive: true }),
    is_under_repair: z.boolean(),
    notes: optionalText(),
    house_rules: optionalText(3000),
    is_listed: z.boolean(),
    contact_phone: optionalText(32),
    has_telegram: z.boolean(),
    listing_price: integerString({ required: false, positive: true }),
    listing_description: optionalText(3000),
  })
  .superRefine((v, ctx) => {
    if (v.is_listed && !v.listing_price) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["listing_price"], ...msg("validation.required") });
    }
  });

type Values = z.input<typeof schema>;
const FIELDS = [
  "name", "address", "kind", "area_m2", "rooms", "is_under_repair", "notes", "house_rules", "is_listed", "contact_phone", "has_telegram", "listing_price", "listing_description",
] as const;

function toValues(p?: Property | null, listed = false): Values {
  return {
    name: p?.name ?? "",
    address: p?.address ?? "",
    kind: p?.kind ?? "apartment",
    area_m2: p?.area_m2 != null ? String(p.area_m2) : "",
    rooms: p?.rooms != null ? String(p.rooms) : "",
    is_under_repair: p?.is_under_repair ?? false,
    notes: p?.notes ?? "",
    house_rules: p?.house_rules ?? "",
    is_listed: p?.is_listed ?? listed,
    contact_phone: p?.contact_phone ?? "",
    has_telegram: p?.has_telegram ?? true,
    listing_price: p?.listing_price != null ? String(p.listing_price) : "",
    listing_description: p?.listing_description ?? "",
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null — создание, объект — редактирование */
  property: Property | null;
  onSaved?: (property: Property) => void;
  /** при создании сразу включить публикацию в поиске */
  defaultListed?: boolean;
}

export function PropertyFormDialog({ open, onOpenChange, property, onSaved, defaultListed = false }: Props) {
  const { t } = useTranslation();
  const create = propertiesApi.useCreate();
  const update = propertiesApi.useUpdate();
  const kindOptions = useKindOptions();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const isEdit = property !== null;
  const pending = create.isPending || update.isPending;

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(property, defaultListed) });
  const { errors } = form.formState;
  const listed = form.watch("is_listed");

  useEffect(() => {
    if (open) {
      form.reset(toValues(property, defaultListed));
      setFormErrors([]);
    }
  }, [open, property, form, defaultListed]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormErrors([]);
    const input: PropertyInput = {
      ...values,
      area_m2: values.area_m2 || null,
      rooms: values.rooms ? Number(values.rooms) : null,
      listing_price: values.listing_price ? Number(values.listing_price) : null,
    };
    try {
      const saved = isEdit ? await update.mutateAsync({ id: property.id, input }) : await create.mutateAsync(input);
      toast.success(t(isEdit ? "properties.updated" : "properties.created"));
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      setFormErrors(applyServerErrors(error, form.setError, FIELDS));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent
        title={t(isEdit ? "properties.editTitle" : "properties.createTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="property-form" loading={pending}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <form id="property-form" onSubmit={onSubmit} noValidate className="space-y-4">
          <FormAlert messages={formErrors} />
          <FormField label={t("properties.fields.name")} error={errors.name?.message}>
            {(p) => <Input {...p} placeholder={t("properties.fields.namePlaceholder")} {...form.register("name")} />}
          </FormField>
          <FormField label={t("properties.fields.address")} error={errors.address?.message}>
            {(p) => <Input {...p} autoComplete="street-address" {...form.register("address")} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("properties.fields.kind")} error={errors.kind?.message}>
              {(p) => (
                <Controller
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <Select
                      {...p}
                      ref={field.ref}
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                      options={kindOptions}
                    />
                  )}
                />
              )}
            </FormField>
            <FormField label={t("properties.fields.area")} error={errors.area_m2?.message} optional>
              {(p) => <Input {...p} inputMode="decimal" className="tabular" {...form.register("area_m2")} />}
            </FormField>
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register("is_under_repair")} />
            <span>
              <span className="block text-sm font-medium">{t("properties.fields.underRepair")}</span>
              <span className="block text-xs text-muted-foreground">{t("properties.fields.underRepairHint")}</span>
            </span>
          </label>
          <FormField label={t("common.notes")} error={errors.notes?.message} optional>
            {(p) => <Textarea {...p} {...form.register("notes")} />}
          </FormField>
          <FormField label={t("properties.fields.houseRules")} error={errors.house_rules?.message} hint={t("properties.fields.houseRulesHint")} optional>
            {(p) => <Textarea {...p} rows={4} placeholder={t("properties.fields.houseRulesPlaceholder")} {...form.register("house_rules")} />}
          </FormField>

          <div className="space-y-4 rounded-xl border border-border p-3">
            <label className="flex min-h-11 cursor-pointer items-start gap-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register("is_listed")} />
              <span>
                <span className="block text-sm font-medium">{t("listing.fields.isListed")}</span>
                <span className="block text-xs text-muted-foreground">{t("listing.fields.isListedHint")}</span>
              </span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register("has_telegram")} />
              <span>
                <span className="block text-sm font-medium">{t("listing.fields.hasTelegram")}</span>
                <span className="block text-xs text-muted-foreground">{t("listing.fields.hasTelegramHint")}</span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <FormField
                label={t("listing.fields.price")}
                error={errors.listing_price?.message}
                hint={t("listing.fields.priceHint")}
                optional={!listed}
              >
                {(p) => <MoneyInput {...p} className="tabular" placeholder="4 000 000" {...form.register("listing_price")} />}
              </FormField>
              <FormField label={t("listing.fields.phone")} error={errors.contact_phone?.message} hint={t("listing.fields.phoneHint")} optional>
                {(p) => <Input {...p} type="tel" className="tabular" {...form.register("contact_phone")} />}
              </FormField>
              <FormField label={t("listing.fields.rooms")} error={errors.rooms?.message} optional>
                {(p) => <Input {...p} inputMode="numeric" className="tabular" {...form.register("rooms")} />}
              </FormField>
            </div>
            <FormField label={t("listing.fields.description")} error={errors.listing_description?.message} optional>
              {(p) => <Textarea {...p} rows={4} placeholder={t("listing.fields.descriptionPlaceholder")} {...form.register("listing_description")} />}
            </FormField>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
