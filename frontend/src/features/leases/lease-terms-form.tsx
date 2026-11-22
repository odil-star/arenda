import { zodResolver } from "@hookform/resolvers/zod";
import { addMonths, format, parseISO } from "date-fns";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { InventoryEditor } from "./inventory-editor";
import { MoneyInput } from "@/components/ui/money-input";
import { Input, Textarea } from "@/components/ui/input";
import { FormAlert, FormField } from "@/components/common/form-field";
import { applyServerErrors } from "@/api/errors";
import type { LeaseInput } from "@/api/types";
import { todayISO } from "@/lib/format";
import { integerString, isoDate, msg, optionalText } from "@/lib/validation";

const schema = z
  .object({
    start_date: isoDate(),
    end_date: isoDate(),
    rent_amount: integerString({ positive: true }),
    deposit_amount: integerString({ required: false }),
    payment_day: z
      .string()
      .regex(/^\d{1,2}$/, msg("validation.paymentDay"))
      .refine((v) => Number(v) >= 1 && Number(v) <= 28, msg("validation.paymentDay")),
    payment_details: optionalText(),
    inventory: optionalText(5000),
    notes: optionalText(),
  })
  .refine((v) => v.end_date > v.start_date, { path: ["end_date"], ...msg("validation.endAfterStart") });

type Values = z.input<typeof schema>;
export type LeaseTerms = Omit<LeaseInput, "property" | "tenant">;
const FIELDS = ["start_date", "end_date", "rent_amount", "deposit_amount", "payment_day", "payment_details", "inventory", "notes"] as const;

function defaults(): Values {
  const start = todayISO();
  return {
    start_date: start,
    end_date: format(addMonths(parseISO(start), 12), "yyyy-MM-dd"),
    rent_amount: "",
    deposit_amount: "",
    payment_day: String(Math.min(28, new Date().getDate())),
    payment_details: "",
    inventory: "",
    notes: "",
  };
}

interface Props {
  formId: string;
  /** Возвращает ошибку запроса, если сервер отклонил договор */
  onSubmit: (terms: LeaseTerms) => Promise<unknown>;
}

export function LeaseTermsForm({ formId, onSubmit }: Props) {
  const { t } = useTranslation();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    setFormErrors([]);
    const error = await onSubmit({
      start_date: v.start_date,
      end_date: v.end_date,
      rent_amount: Number(v.rent_amount),
      deposit_amount: Number(v.deposit_amount || 0),
      payment_day: Number(v.payment_day),
      payment_details: v.payment_details,
      inventory: v.inventory,
      notes: v.notes,
    });
    if (error) setFormErrors(applyServerErrors(error, form.setError, FIELDS));
  });

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4">
      <FormAlert messages={formErrors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("leases.fields.startDate")} error={errors.start_date?.message}>
          {(p) => <Input {...p} type="date" {...form.register("start_date")} />}
        </FormField>
        <FormField label={t("leases.fields.endDate")} error={errors.end_date?.message}>
          {(p) => <Input {...p} type="date" {...form.register("end_date")} />}
        </FormField>
        <FormField label={t("leases.fields.rent")} error={errors.rent_amount?.message} hint={t("leases.fields.rentHint")}>
          {(p) => <MoneyInput {...p} className="tabular" placeholder="2 000 000" {...form.register("rent_amount")} />}
        </FormField>
        <FormField label={t("leases.fields.deposit")} error={errors.deposit_amount?.message} optional>
          {(p) => <MoneyInput {...p} className="tabular" {...form.register("deposit_amount")} />}
        </FormField>
        <FormField label={t("leases.fields.paymentDay")} error={errors.payment_day?.message} hint={t("leases.fields.paymentDayHint")}>
          {(p) => <Input {...p} inputMode="numeric" className="tabular" {...form.register("payment_day")} />}
        </FormField>
      </div>
      <FormField label={t("leases.inventory.field")} error={errors.inventory?.message} hint={t("leases.inventory.hint")} optional>
        {() => (
          <InventoryEditor
            value={form.watch("inventory") ?? ""}
            onChange={(v) => form.setValue("inventory", v, { shouldDirty: true })}
          />
        )}
      </FormField>
      <FormField label={t("leases.details.field")} error={errors.payment_details?.message} hint={t("leases.details.hint")} optional>
        {(p) => <Textarea {...p} rows={3} placeholder={t("leases.details.placeholder")} {...form.register("payment_details")} />}
      </FormField>
      <FormField label={t("common.notes")} error={errors.notes?.message} optional>
        {(p) => <Textarea {...p} {...form.register("notes")} />}
      </FormField>
    </form>
  );
}
