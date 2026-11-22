import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/**
 * Состояние фильтров в URL: переживает перезагрузку и «назад».
 * Любое изменение фильтра, кроме самой страницы, сбрасывает page.
 */
export function useUrlState<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();

  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ""])) as Record<K, string>;
  const page = Math.max(1, Number(params.get("page")) || 1);

  const set = useCallback(
    (key: K | "page", value: string | number | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value === "" || (key === "page" && value === 1)) next.delete(key);
          else next.set(key, String(value));
          if (key !== "page") next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { values, page, set };
}

/** Плавно «докручивает» число до target. При prefers-reduced-motion сразу ставит значение. */
export function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = current.current;
    if (reduced || from === target) {
      current.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(from + (target - from) * eased);
      current.current = next;
      setValue(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
