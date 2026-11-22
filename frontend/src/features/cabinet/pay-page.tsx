import { ArrowLeft, FileText, ImageUp, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { groupDigits, MoneyInput } from "@/components/ui/money-input";
import { Skeleton } from "@/components/ui/skeleton";
import { FormAlert, FormField } from "@/components/common/form-field";
import { errorKind, serverMessages } from "@/api/errors";
import { useSendReceipt, useTenantPayments, type TenantPayment } from "@/api/portal";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Requisites } from "./cabinet-ui";

const MAX_BYTES = 10 * 1024 * 1024;

/** «Назад»: к предыдущему экрану, а если страницу открыли по ссылке — в кабинет. */
function useBack() {
  const navigate = useNavigate();
  const location = useLocation();
  return () => (location.key === "default" ? navigate("/cabinet", { replace: true }) : navigate(-1));
}

/** Страница оплаты: реквизиты (с копированием), сумма и чек — отправляется арендодателю на подтверждение. */
export function PayCabinetPage() {
  const { t } = useTranslation();
  const back = useBack();
  const { paymentId } = useParams();
  const payments = useTenantPayments();
  const payment = payments.data?.find((p) => String(p.id) === paymentId);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 pb-12">
      <header className="flex h-14 items-center">
        <Button variant="ghost" size="icon" className="-ml-2" onClick={back} aria-label={t("common.back")}>
          <ArrowLeft aria-hidden />
        </Button>
      </header>
      {payments.isPending ? (
        <Skeleton className="h-60 w-full" />
      ) : payment && payment.can_pay ? (
        <PayForm key={payment.id} payment={payment} onDone={back} />
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          {payment?.receipt_status === "pending" ? t("cabinet.reviewNote") : t("cabinet.pay.nothing")}
        </p>
      )}
    </div>
  );
}

function FilePick({ id, file, onChange, describedBy }: { id: string; file: File | null; onChange: (f: File | null) => void; describedBy?: string }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        {preview ? (
          <img src={preview} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
        ) : (
          <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="size-6" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} aria-label={t("cabinet.pay.removeFile")}>
          <X aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <label
      htmlFor={id}
      className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card p-4 text-center transition-colors hover:border-primary/50 hover:bg-accent/40 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
    >
      <ImageUp className="size-7 text-primary" aria-hidden />
      <span className="text-sm font-medium">{t("cabinet.pay.pickFile")}</span>
      <span className="text-xs text-muted-foreground">{t("cabinet.pay.fileHint")}</span>
      <input
        id={id}
        type="file"
        aria-describedby={describedBy}
        accept="image/png,image/jpeg,application/pdf"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="sr-only"
      />
    </label>
  );
}

function PayForm({ payment, onDone }: { payment: TenantPayment; onDone: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const send = useSendReceipt();
  const [amount, setAmount] = useState(String(payment.remaining));
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const full = Number(amount.replace(/\s/g, "")) === payment.remaining;

  const submit = async () => {
    setErrors([]);
    const value = Number(amount.replace(/\s/g, ""));
    if (!Number.isInteger(value) || value < 1 || value > payment.remaining) {
      return setErrors([t("cabinet.pay.amountInvalid", { max: fmt.money(payment.remaining) })]);
    }
    if (!file) return setErrors([t("cabinet.pay.fileRequired")]);
    if (file.size > MAX_BYTES) return setErrors([t("cabinet.pay.fileTooBig")]);
    try {
      await send.mutateAsync({ paymentId: payment.id, file, amount: value });
      toast.success(t("cabinet.pay.sent"));
      onDone();
    } catch (error) {
      const messages = serverMessages(error);
      setErrors(messages.length ? messages : [t(`errors.${errorKind(error)}.description`)]);
    }
  };

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight first-letter:uppercase">{t("cabinet.forMonth", { month: fmt.month(payment.due_date) })}</h1>
        <p className="text-sm text-muted-foreground">{payment.property_name}</p>
      </div>

      <Card className="rounded-2xl p-4">
        <p className="text-sm text-muted-foreground">{t("cabinet.due")}</p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{fmt.money(payment.remaining)}</p>
        {payment.amount_paid > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">{t("cabinet.remainingOf", { remaining: fmt.money(payment.remaining), total: fmt.money(payment.amount_due) })}</p>
        )}
        {payment.receipt_status === "rejected" && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {t("cabinet.pay.rejected")}
              {payment.receipt_reject_reason && <>. {t("cabinet.pay.reason", { reason: payment.receipt_reject_reason })}</>}
            </span>
          </p>
        )}
      </Card>

      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Step n={1} title={t("cabinet.pay.step1")}>
          <Requisites payment={payment} />
        </Step>

        <Step n={2} title={t("cabinet.pay.step2")}>
          <FormField label={t("cabinet.pay.amount")} hint={t("cabinet.pay.amountHint", { max: fmt.money(payment.remaining) })}>
            {(p) => <MoneyInput {...p} value={groupDigits(amount)} onChange={(e) => setAmount(e.target.value)} />}
          </FormField>
          {!full && (
            <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setAmount(String(payment.remaining))}>
              {t("cabinet.pay.fullAmount", { amount: fmt.money(payment.remaining) })}
            </Button>
          )}
        </Step>

        <Step n={3} title={t("cabinet.pay.file")}>
          <FilePick id="receipt-file" file={file} onChange={setFile} />
        </Step>

        <FormAlert messages={errors} />
        <Button type="submit" size="lg" className="w-full" loading={send.isPending}>
          {t("cabinet.pay.send")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t("cabinet.pay.description", { landlord: payment.landlord_name })}</p>
      </form>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden className={cn("flex size-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground")}>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
