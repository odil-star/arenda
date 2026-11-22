import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money-input";
import { Parties } from "@/components/common/entity-names";
import { FormAlert, FormField } from "@/components/common/form-field";
import { applyServerErrors } from "@/api/errors";
import { usePayPayment } from "@/api/hooks";
import type { Payment } from "@/api/types";
import { useFormat } from "@/lib/format";
import { toNumber } from "@/lib/utils";
import { integerString, msg } from "@/lib/validation";

function makeSchema(balance: number) {
  return z.object({
    amount: integerString({ positive: true }).refine((v) => !v || Number(v) <= balance, msg("validation.overBalance")),
  });
}

type PayValues = z.input<ReturnType<typeof makeSchema>>;

interface PayDialogProps {
  payment: Payment | null;
  onOpenChange: (open: boolean) => void;
}

function PaySuccess({ amount, rest }: { amount: string; rest: string | null }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex flex-col items-center py-6 text-center">
      <span className="animate-pop flex size-16 items-center justify-center rounded-full bg-success-soft">
        <svg viewBox="0 0 24 24" className="size-8 text-success" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path className="animate-draw" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <p className="mt-4 font-display text-lg font-semibold">{t("payments.successTitle", { amount })}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {rest ? t("payments.successRest", { rest }) : t("payments.successFull")}
      </p>
    </div>
  );
}

/** Отметить оплату: по умолчанию весь остаток, можно меньше (частичная оплата). */
export function PayDialog({ payment, onOpenChange }: PayDialogProps) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const pay = usePayPayment();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  /** После успешной оплаты показываем «галочку», затем закрываем окно */
  const [done, setDone] = useState<{ amount: number; rest: number } | null>(null);
  const balance = payment?.remaining ?? 0;
  const schema = useMemo(() => makeSchema(balance), [balance]);

  const form = useForm<PayValues>({ resolver: zodResolver(schema), defaultValues: { amount: "" } });

  useEffect(() => {
    if (payment) {
      form.reset({ amount: String(payment.remaining) });
      setFormErrors([]);
      setDone(null);
    }
  }, [payment, form]);

  // родители передают inline-колбэк — держим актуальный в ref, чтобы не перезапускать таймер
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => onOpenChangeRef.current(false), 1500);
    return () => window.clearTimeout(id);
  }, [done]);

  const amountValue = toNumber(form.watch("amount"));
  const isPartial = amountValue > 0 && amountValue < balance;

  // resolver уже вернул нормализованную строку ("1500000.50")
  const onSubmit = form.handleSubmit(async ({ amount }) => {
    if (!payment) return;
    setFormErrors([]);
    try {
      await pay.mutateAsync({ id: payment.id, input: { amount: Number(amount) } });
      toast.success(t("payments.paidToast", { amount: fmt.money(amount) }));
      setDone({ amount: Number(amount), rest: balance - Number(amount) });
    } catch (error) {
      setFormErrors(applyServerErrors(error, form.setError, ["amount"]));
    }
  });

  return (
    <Dialog open={payment !== null} onOpenChange={(o) => !pay.isPending && onOpenChange(o)}>
      {payment && (
        <DialogContent
          title={t("payments.payTitle")}
          description={<Parties item={payment} />}
          footer={
            done ? undefined : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pay.isPending}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" form="pay-form" loading={pay.isPending}>
                {t("payments.payAction")}
              </Button>
            </>
            )
          }
        >
          {done ? (
            <PaySuccess amount={fmt.money(done.amount)} rest={done.rest > 0 ? fmt.money(done.rest) : null} />
          ) : (
          <>
          <dl className="mb-5 grid grid-cols-3 gap-3 rounded-lg bg-muted p-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{t("payments.dueDate")}</dt>
              <dd className="mt-0.5 font-medium tabular">{fmt.date(payment.due_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("payments.amountDue")}</dt>
              <dd className="mt-0.5 font-medium tabular">{fmt.money(payment.amount_due)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("payments.paid")}</dt>
              <dd className="mt-0.5 font-medium tabular">{fmt.money(payment.amount_paid)}</dd>
            </div>
          </dl>

          <form id="pay-form" onSubmit={onSubmit} noValidate className="space-y-4">
            <FormAlert messages={formErrors} />
            <FormField
              label={t("payments.amount")}
              error={form.formState.errors.amount?.message}
              hint={
                isPartial
                  ? t("payments.partialHint", { rest: fmt.money(balance - amountValue) })
                  : t("payments.balanceHint", { balance: fmt.money(balance) })
              }
            >
              {(p) => (
                <div className="relative">
                  <MoneyInput {...p} className="pr-14 tabular" {...form.register("amount")} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {t("common.currency")}
                  </span>
                </div>
              )}
            </FormField>
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => form.setValue("amount", String(balance), { shouldValidate: true })}
            >
              {t("payments.payFull")}
            </Button>
          </form>
          </>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
