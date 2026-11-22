import { differenceInCalendarDays, format, isValid, parseISO, type Locale } from "date-fns";
import { ru, uz } from "date-fns/locale";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Money } from "@/api/types";
import { toNumber } from "./utils";

export type AppLanguage = "ru" | "uz";

const intlLocale: Record<AppLanguage, string> = { ru: "ru-RU", uz: "uz-Latn-UZ" };
const dateLocale: Record<AppLanguage, Locale> = { ru, uz };

export function asLanguage(lng: string | undefined): AppLanguage {
  return lng?.startsWith("uz") ? "uz" : "ru";
}

function parseDate(value: string): Date | null {
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

/** Форматтеры, зависящие от текущего языка интерфейса. */
export function useFormat() {
  const { t, i18n } = useTranslation();
  const lang = asLanguage(i18n.language);
  const currency = t("common.currency");

  return useMemo(() => {
    const numberFmt = new Intl.NumberFormat(intlLocale[lang], { maximumFractionDigits: 2 });

    return {
      lang,
      /** 2000000 → «2 000 000 сум» */
      money: (value: Money | null | undefined) => `${numberFmt.format(toNumber(value))} ${currency}`,
      number: (value: Money | null | undefined) => numberFmt.format(toNumber(value)),
      /** ISO → ДД.ММ.ГГГГ */
      date: (value: string | null | undefined) => {
        const d = value ? parseDate(value) : null;
        return d ? format(d, "dd.MM.yyyy") : "—";
      },
      /** "2026-11" или "2026-11-01" → «ноябрь 2026» */
      month: (value: string) => {
        const d = parseDate(value.length === 7 ? `${value}-01` : value);
        return d ? format(d, "LLLL yyyy", { locale: dateLocale[lang] }) : value;
      },
      /** ISO → «авг» / «avg» */
      monthShort: (value: string) => {
        const d = parseDate(value);
        return d ? format(d, "LLL", { locale: dateLocale[lang] }).replace(".", "") : "";
      },
      /** «20 млн» / «20 mln» — для осей графиков */
      compact: (value: number) =>
        new Intl.NumberFormat(intlLocale[lang], { notation: "compact", maximumFractionDigits: 1 }).format(value),
      daysFromToday: (value: string) => {
        const d = parseDate(value);
        return d ? differenceInCalendarDays(new Date(), d) : 0;
      },
    };
  }, [lang, currency]);
}

/** ISO-дата-время → «ДД.ММ.ГГГГ ЧЧ:ММ» (по местному времени браузера), как и fmt.date — без названий месяцев. */
export function formatDateTime(value: string | null | undefined, withSeconds = false): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : format(d, withSeconds ? "dd.MM.yyyy HH:mm:ss" : "dd.MM.yyyy HH:mm");
}

export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}
