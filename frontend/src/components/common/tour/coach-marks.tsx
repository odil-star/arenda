import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export interface CoachTarget {
  /** имя подсказки в locales: tour.coach.<name>.title / .text */
  name: string;
  /** CSS-селекторы по приоритету; берётся первый элемент, который сейчас виден на экране */
  selectors: string[];
}

export const COACH_TARGETS: Record<"tenant" | "landlord", CoachTarget[]> = {
  landlord: [
    { name: "properties", selectors: ['[data-tour="nav-properties"]'] },
    { name: "tenants", selectors: ['[data-tour="nav-tenants"]'] },
    { name: "payments", selectors: ['[data-tour="nav-payments"]'] },
    { name: "add", selectors: ['[data-tour="quick-add"]'] },
    { name: "support", selectors: ['[data-tour="support"]', '[data-tour="nav-support"]'] },
  ],
  tenant: [
    { name: "pay", selectors: ['[data-tour="pay-btn"]'] },
    { name: "tabPayments", selectors: ['[data-tour="tab-payments"]'] },
    { name: "tabContract", selectors: ['[data-tour="tab-contract"]'] },
    { name: "support", selectors: ['[data-tour="support"]'] },
    { name: "tabProfile", selectors: ['[data-tour="tab-profile"]'] },
  ],
};

function findVisible(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

const PAD = 6;

/**
 * Обучение на настоящем интерфейсе: затемняет экран и обводит реальные кнопки по одной.
 * Подсказки для элементов, которых сейчас нет на экране, пропускаются.
 */
export function CoachMarks({ targets, onClose }: { targets: CoachTarget[]; onClose: () => void }) {
  const { t } = useTranslation();
  const found = useMemo(() => targets.map((tg) => ({ tg, el: findVisible(tg.selectors) })).filter((x): x is { tg: CoachTarget; el: HTMLElement } => x.el !== null), [targets]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const current = found[index];

  const measure = useCallback(() => {
    setVp({ w: window.innerWidth, h: window.innerHeight });
    setRect(current ? current.el.getBoundingClientRect() : null);
  }, [current]);

  useEffect(() => {
    if (found.length === 0) onClose();
  }, [found.length, onClose]);

  useLayoutEffect(() => {
    if (!current) return;
    current.el.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(current.el);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [current, measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "Enter") setIndex((i) => (i < found.length - 1 ? i + 1 : (onClose(), i)));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [found.length, onClose]);

  if (!current || !rect) return null;

  const last = index === found.length - 1;
  const hole = { x: rect.left - PAD, y: rect.top - PAD, w: rect.width + PAD * 2, h: rect.height + PAD * 2 };
  const below = hole.y + hole.h + 190 < vp.h; // хватает места под элементом — подсказка снизу, иначе сверху
  const tipW = Math.min(320, vp.w - 24);
  const left = Math.min(Math.max(12, hole.x + hole.w / 2 - tipW / 2), vp.w - tipW - 12);
  const arrowX = Math.min(Math.max(20, hole.x + hole.w / 2 - left), tipW - 20);

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={t("tour.label")}>
      <svg className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <mask id="coach-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="16" fill="black" className="transition-all duration-300" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.72)" mask="url(#coach-mask)" />
      </svg>
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-2xl outline outline-2 outline-white/90 animate-ring transition-all duration-300"
        style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
      />
      <div
        key={index}
        className="absolute animate-rise-in rounded-2xl bg-popover p-4 text-popover-foreground shadow-2xl ring-1 ring-border"
        style={{ left, width: tipW, ...(below ? { top: hole.y + hole.h + 14 } : { bottom: vp.h - hole.y + 14 }) }}
      >
        <span
          aria-hidden
          className="absolute size-3 rotate-45 bg-popover ring-1 ring-border"
          style={{ left: arrowX - 6, ...(below ? { top: -6 } : { bottom: -6 }), clipPath: below ? "polygon(0 0, 100% 0, 0 100%)" : "polygon(100% 100%, 100% 0, 0 100%)" }}
        />
        <p className="text-xs font-medium text-muted-foreground">{t("tour.step", { current: index + 1, total: found.length })}</p>
        <p className="mt-1 text-base font-semibold">{t(`tour.coach.${current.tg.name}.title` as never)}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`tour.coach.${current.tg.name}.text` as never)}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>{t("tour.skip")}</Button>
          <Button size="sm" onClick={() => (last ? onClose() : setIndex(index + 1))}>{last ? t("tour.coachDone") : t("tour.next")}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
