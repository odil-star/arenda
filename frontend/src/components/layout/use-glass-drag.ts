import { useRef, useState, type MouseEvent, type PointerEvent } from "react";

const PAD = 6; // p-1.5 капсулы
const THRESHOLD = 8; // px, после которых нажатие превращается в перетаскивание

/**
 * «Зажать и провести» по нижней навигации, как в Instagram / YouTube:
 * подсветка следует за пальцем, иконки под ней переключаются на лету,
 * а страница меняется сразу, пока палец скользит.
 * Простой тап работает как обычный клик по вкладке.
 */
export function useGlassDrag(count: number, onCommit: (index: number) => void) {
  const ref = useRef<HTMLUListElement>(null);
  const st = useRef({ id: -1, startX: 0, active: false, last: -1, suppress: false });
  const [pos, setPos] = useState<number | null>(null);

  const toIndex = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const cell = (r.width - PAD * 2) / count;
    return Math.min(count - 1, Math.max(0, (clientX - r.left - PAD) / cell - 0.5));
  };

  const reset = () => {
    st.current.id = -1;
    st.current.active = false;
    st.current.last = -1;
    setPos(null);
  };

  return {
    ref,
    /** дробный индекс подсветки под пальцем, null — когда не тянем */
    pos,
    /** вкладка под пальцем (целая) или null */
    hover: pos === null ? null : Math.round(pos),
    handlers: {
      onPointerDown: (e: PointerEvent<HTMLUListElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        st.current = { ...st.current, id: e.pointerId, startX: e.clientX, active: false, last: -1 };
      },
      onPointerMove: (e: PointerEvent<HTMLUListElement>) => {
        const s = st.current;
        if (e.pointerId !== s.id) return;
        if (!s.active) {
          if (Math.abs(e.clientX - s.startX) < THRESHOLD) return;
          s.active = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        const p = toIndex(e.clientX);
        setPos(p);
        const r = Math.round(p);
        if (r !== s.last) {
          if (s.last !== -1) navigator.vibrate?.(6);
          s.last = r;
          // страница меняется сразу, пока палец скользит по вкладкам
          onCommit(r);
        }
      },
      onPointerUp: (e: PointerEvent<HTMLUListElement>) => {
        const s = st.current;
        if (e.pointerId !== s.id) return;
        if (s.active) {
          s.suppress = true;
          setTimeout(() => (st.current.suppress = false), 0);
        }
        reset();
      },
      onPointerCancel: (e: PointerEvent<HTMLUListElement>) => {
        if (e.pointerId === st.current.id) reset();
      },
      // после перетаскивания браузер не должен ещё и «кликнуть» по вкладке
      onClickCapture: (e: MouseEvent) => {
        if (st.current.suppress) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
    },
  };
}
