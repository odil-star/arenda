import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ChangeEvent, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";

/** "1000000" → "1 000 000" (только цифры, группы по 3 через пробел). */
export function groupDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Поле суммы: на лету разделяет разряды пробелами. Значение содержит пробелы — парсеры уже их убирают. */
export const MoneyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ onChange, ...props }, ref) => {
    const inner = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inner.current as HTMLInputElement);

    // Значения, выставленные программно (reset/setValue/defaultValue), тоже форматируем.
    useLayoutEffect(() => {
      const el = inner.current;
      if (el && el.value !== groupDigits(el.value)) el.value = groupDigits(el.value);
    });

    const handle = (e: ChangeEvent<HTMLInputElement>) => {
      const el = e.target;
      const caret = el.selectionStart ?? el.value.length;
      const digitsBefore = el.value.slice(0, caret).replace(/\D/g, "").length;
      const formatted = groupDigits(el.value);
      if (formatted !== el.value) {
        el.value = formatted;
        let pos = 0;
        for (let seen = 0; pos < formatted.length && seen < digitsBefore; pos++) {
          if (/\d/.test(formatted[pos])) seen++;
        }
        el.setSelectionRange(pos, pos);
      }
      onChange?.(e);
    };

    return <Input ref={inner} inputMode="numeric" autoComplete="off" {...props} onChange={handle} />;
  },
);
MoneyInput.displayName = "MoneyInput";
