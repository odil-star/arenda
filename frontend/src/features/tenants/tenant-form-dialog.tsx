import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormAlert, FormField } from "@/components/common/form-field";
import { applyServerErrors } from "@/api/errors";
import { tenantsApi } from "@/api/hooks";
import type { Tenant, TenantInput } from "@/api/types";
import { msg, optionalText, requiredText } from "@/lib/validation";
import { TelegramLink } from "./telegram-link";

const schema = z.object({
  full_name: requiredText(200),
  phone: z
    .string()
    .trim()
    .min(1, msg("validation.required"))
    .regex(/^\+?[\d\s()-]{7,20}$/, msg("validation.phone")),
  passport: optionalText(100),
  notes: optionalText(),
  language: z.enum(["ru", "uz"]),
});

type Values = z.infer<typeof schema>;
const FIELDS = ["full_name", "phone", "passport", "notes", "language"] as const;

function toValues(tn?: Tenant | null): Values {
  return {
    full_name: tn?.full_name ?? "",
    phone: tn?.phone ?? "",
    passport: tn?.passport ?? "",
    notes: tn?.notes ?? "",
    language: tn?.language ?? "ru",
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: Tenant | null;
  onSaved?: (tenant: Tenant) => void;
}

export function TenantFormDialog({ open, onOpenChange, tenant, onSaved }: Props) {
  const { t } = useTranslation();
  const create = tenantsApi.useCreate();
  const update = tenantsApi.useUpdate();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const isEdit = tenant !== null;
  const pending = create.isPending || update.isPending;

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(tenant) });
  const { errors } = form.formState;

  useEffect(() => {
    if (open) {
      form.reset(toValues(tenant));
      setFormErrors([]);
    }
  }, [open, tenant, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormErrors([]);
    const input: TenantInput = values;
    try {
      const saved = isEdit ? await update.mutateAsync({ id: tenant.id, input }) : await create.mutateAsync(input);
      toast.success(t(isEdit ? "tenants.updated" : "tenants.created"));
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      setFormErrors(applyServerErrors(error, form.setError, FIELDS));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent
        title={t(isEdit ? "tenants.editTitle" : "tenants.createTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="tenant-form" loading={pending}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <form id="tenant-form" onSubmit={onSubmit} noValidate className="space-y-4">
          <FormAlert messages={formErrors} />
          <FormField label={t("tenants.fields.fullName")} error={errors.full_name?.message}>
            {(p) => <Input {...p} autoComplete="name" {...form.register("full_name")} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("tenants.fields.phone")} error={errors.phone?.message}>
              {(p) => (
                <Input {...p} type="tel" inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" {...form.register("phone")} />
              )}
            </FormField>
            <FormField label={t("tenants.fields.language")} error={errors.language?.message} hint={t("tenants.fields.languageHint")}>
              {(p) => (
                <Controller
                  control={form.control}
                  name="language"
                  render={({ field }) => (
                    <Select
                      {...p}
                      ref={field.ref}
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                      options={[
                        { value: "ru", label: t("language.ru") },
                        { value: "uz", label: t("language.uz") },
                      ]}
                    />
                  )}
                />
              )}
            </FormField>
          </div>
          <FormField label={t("tenants.fields.passport")} error={errors.passport?.message} optional>
            {(p) => <Input {...p} autoCapitalize="characters" placeholder="AA 1234567" {...form.register("passport")} />}
          </FormField>
          <FormField label={t("common.notes")} error={errors.notes?.message} optional>
            {(p) => <Textarea {...p} {...form.register("notes")} />}
          </FormField>
        </form>

        {tenant && <TelegramLink tenant={tenant} />}
      </DialogContent>
    </Dialog>
  );
}
