import { z } from "zod";
import type { ValidationKey } from "@/locales";
import { normalizeDecimal } from "./utils";

/** Сообщения zod — ключи i18n; переводятся в FormField. */
export const msg = (key: ValidationKey) => ({ message: key });

export const requiredText = (max = 255) =>
  z.string().trim().min(1, msg("validation.required")).max(max, msg("validation.tooLong"));

export const optionalText = (max = 2000) => z.string().trim().max(max, msg("validation.tooLong"));

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

/** Сумма в виде строки: допускает пробелы и запятую, хранится как "1500000.50". */
export const decimalString = ({ required = true, positive = false } = {}) =>
  z
    .string()
    .transform((v) => normalizeDecimal(v))
    .superRefine((v, ctx) => {
      if (!v) {
        if (required) ctx.addIssue({ code: z.ZodIssueCode.custom, ...msg("validation.required") });
        return;
      }
      if (!DECIMAL_RE.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, ...msg("validation.number") });
        return;
      }
      if (positive && Number(v) <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, ...msg("validation.positive") });
    });

/** Целая сумма в сумах (API принимает IntegerField): "2 000 000" → "2000000". */
export const integerString = ({ required = true, positive = false } = {}) =>
  z
    .string()
    .transform((v) => v.replace(/\s/g, ""))
    .superRefine((v, ctx) => {
      if (!v) {
        if (required) ctx.addIssue({ code: z.ZodIssueCode.custom, ...msg("validation.required") });
        return;
      }
      if (!/^\d+$/.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, ...msg("validation.integer") });
        return;
      }
      if (positive && Number(v) <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, ...msg("validation.positive") });
    });

export const isoDate =() => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg("validation.date"));
