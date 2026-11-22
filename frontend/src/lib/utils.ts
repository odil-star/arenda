import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** "1 500 000,50" → "1500000.50" — то, что ждёт DecimalField */
export function normalizeDecimal(value: string): string {
  // \s в JS уже включает неразрывные пробелы (U+00A0, U+202F) из Intl.NumberFormat
  return value.replace(/\s/g, "").replace(",", ".");
}

export const PAGE_SIZE = 20;
