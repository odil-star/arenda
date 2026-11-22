import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Популярные вещи в аренде. Храним готовый текст на языке интерфейса, сравниваем по обоим языкам. */
const PRESETS = [
  { ru: "Телевизор", uz: "Televizor" },
  { ru: "Холодильник", uz: "Sovutgich" },
  { ru: "Кондиционер", uz: "Konditsioner" },
  { ru: "Стиральная машина", uz: "Kir yuvish mashinasi" },
  { ru: "Микроволновая печь", uz: "Mikroto‘lqinli pech" },
  { ru: "Газовая плита", uz: "Gaz plita" },
  { ru: "Духовка", uz: "Duxovka" },
  { ru: "Посудомоечная машина", uz: "Idish yuvish mashinasi" },
  { ru: "Водонагреватель", uz: "Suv isitgich" },
  { ru: "Пылесос", uz: "Changyutgich" },
  { ru: "Утюг", uz: "Dazmol" },
  { ru: "Wi-Fi роутер", uz: "Wi-Fi router" },
  { ru: "Диван", uz: "Divan" },
  { ru: "Кровать", uz: "Krovat" },
  { ru: "Шкаф", uz: "Shkaf" },
  { ru: "Обеденный стол и стулья", uz: "Ovqatlanish stoli va stullar" },
] as const;

export const parseInventory = (text?: string | null) =>
  (text ?? "")
    .split("\n")
    .map((l) => l.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean);

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const presetOf = (line: string) => PRESETS.find((p) => same(p.ru, line) || same(p.uz, line));

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** Выбор вещей чекбоксами + свои пункты. Значение — текст «по пункту в строке». */
export function InventoryEditor({ value, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("uz") ? "uz" : "ru";
  const [custom, setCustom] = useState("");
  const lines = parseInventory(value);
  const emit = (next: string[]) => onChange(next.join("\n"));
  const customLines = lines.filter((l) => !presetOf(l));

  const toggle = (preset: (typeof PRESETS)[number]) => {
    const has = lines.some((l) => presetOf(l) === preset);
    emit(has ? lines.filter((l) => presetOf(l) !== preset) : [...lines, preset[lang]]);
  };

  const addCustom = () => {
    const text = custom.trim();
    if (!text) return;
    if (!lines.some((l) => same(l, text))) emit([...lines, text]);
    setCustom("");
  };

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted-foreground">{t("leases.inventory.popular")}</legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <label key={p.ru} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm sm:min-h-9">
              <input
                type="checkbox"
                className="size-5 accent-[var(--primary)]"
                checked={lines.some((l) => presetOf(l) === p)}
                onChange={() => toggle(p)}
              />
              {p[lang]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{t("leases.inventory.other")}</p>
        {customLines.length > 0 && (
          <ul className="space-y-1">
            {customLines.map((l) => (
              <li key={l} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm">
                <span className="min-w-0 break-words">{l}</span>
                <button
                  type="button"
                  onClick={() => emit(lines.filter((x) => x !== l))}
                  aria-label={t("common.delete")}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            value={custom}
            maxLength={120}
            placeholder={t("leases.inventory.placeholder")}
            aria-label={t("leases.inventory.other")}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={addCustom} disabled={!custom.trim()}>
            <Plus aria-hidden /> {t("leases.inventory.add")}
          </Button>
        </div>
      </div>
    </div>
  );
}
