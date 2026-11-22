import { AlertCircle } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import type { ValidationKey } from "@/locales";
import { cn } from "@/lib/utils";

export interface ControlProps {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
}

interface FormFieldProps {
  label: ReactNode;
  /** Сообщение: ключ `validation.*` (клиент) или готовый текст (сервер) */
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  className?: string;
  children: (control: ControlProps) => ReactNode;
}

function useErrorText() {
  const { t } = useTranslation();
  return (message: string | undefined) => {
    if (!message) return undefined;
    return message.startsWith("validation.") ? t(message as ValidationKey) : message;
  };
}

export function FormField({ label, error, hint, optional, className, children }: FormFieldProps) {
  const { t } = useTranslation();
  const errorText = useErrorText()(error);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, errorText ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="ml-1 font-normal text-muted-foreground">({t("common.optional")})</span>}
      </Label>
      {children({ id, "aria-invalid": errorText ? true : undefined, "aria-describedby": describedBy })}
      {hint && !errorText && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {errorText && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {errorText}
        </p>
      )}
    </div>
  );
}

/** Ошибки сервера, которые не относятся к конкретному полю. */
export function FormAlert({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <div role="alert" className="flex gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <ul className="space-y-0.5">
        {messages.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}
