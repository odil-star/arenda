import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";

/** Номер карты: 13–19 цифр, допускаются пробелы и дефисы между цифрами. */
const CARD_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

/** 1234567890123456 → «123456 **** 3456»: открыты первые 6 и последние 4 цифры. */
function maskCard(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return `${digits.slice(0, 6)} **** ${digits.slice(-4)}`;
}

function CardNumber({ raw }: { raw: string }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const full = raw.replace(/\D/g, "");

  const copy = async () => {
    if (!(await copyText(full))) return;
    toast.success(t("cabinet.cardCopied"));
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };

  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle">
      <span className="font-medium tabular-nums">{maskCard(raw)}</span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t("cabinet.copyCard")}
        title={t("cabinet.copyCard")}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      >
        {done ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </span>
  );
}

/**
 * Реквизиты оплаты. Номера карт на экране скрыты (видны 6 первых и 4 последних цифры),
 * но кнопка рядом копирует номер целиком.
 */
export function PaymentDetails({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CARD_RE)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<CardNumber key={start} raw={m[0]} />);
    last = start + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className={className ?? "whitespace-pre-wrap break-words text-sm"}>{parts}</p>;
}
