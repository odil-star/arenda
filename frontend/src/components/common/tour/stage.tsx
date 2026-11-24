import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Размер «экрана телефона» в условных пикселях: всё рисуется в нём и масштабируется под окно. */
export const W = 300;
export const H = 600;

/** Кадр: куда едет курсор (в % экрана) и нажимает ли он в конце движения. */
export interface Frame {
  x: number;
  y: number;
  tap?: boolean;
}

const FRAME_MS = 2000; // кадр без нажатия
const TAP_AT_MS = 1100; // курсор доехал и нажал
const HOLD_AFTER_TAP_MS = 1300; // пауза на результате нажатия
const LAST_FRAME_MS = 3200;

/** Подсветка элемента, на который сейчас нужно нажать. */
export const hl = (on: boolean) => (on ? "outline outline-2 outline-offset-2 outline-primary animate-ring" : "");

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(q.matches);
    const on = () => setReduce(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduce;
}

let audio: AudioContext | undefined;

/** Короткий «тик» через WebAudio (без файлов) и лёгкая вибрация на телефоне. */
function tapFeedback() {
  try {
    navigator.vibrate?.(12);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    void audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(520, audio.currentTime + 0.09);
    gain.gain.setValueAtTime(0.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.13);
  } catch {
    /* звук необязателен */
  }
}

function Pointer() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" className="drop-shadow-[0_3px_4px_rgba(0,0,0,0.45)]" aria-hidden>
      <path d="M4 2.5v17l4.6-4.1 3 6.6 3-1.4-3-6.4 6.1-.4z" fill="#fff" stroke="#111827" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Анимированный «скриншот»: экран телефона, по которому ездит курсор и нажимает кнопки.
 * `children(f)` рисует экран для кадра f, `captions[f]` — подпись над экраном.
 */
export function Stage({ frames, captions, paused = false, sound = false, children }: { frames: Frame[]; captions: string[]; paused?: boolean; sound?: boolean; children: (f: number) => ReactNode }) {
  const reduce = usePrefersReducedMotion();
  const [f, setF] = useState(0); // кадр курсора
  const [clicked, setClicked] = useState(false); // курсор уже нажал: показываем результат
  const frame = frames[Math.min(f, frames.length - 1)];
  const last = f === frames.length - 1;
  // нажатие в кадре f приводит к экрану кадра f+1 (в последнем кадре курсор только «отдыхает»)
  const ui = clicked && frame.tap && !last ? f + 1 : f;

  useEffect(() => {
    if (reduce) {
      setF(frames.length - 1);
      setClicked(false);
      return;
    }
    if (paused) return;
    const taps = !!frame.tap && !last;
    const wait = last ? LAST_FRAME_MS : taps ? (clicked ? HOLD_AFTER_TAP_MS : TAP_AT_MS) : FRAME_MS;
    const id = setTimeout(() => {
      if (taps && !clicked) {
        setClicked(true);
      } else {
        setClicked(false);
        setF((p) => (p + 1) % frames.length);
      }
    }, wait);
    return () => clearTimeout(id);
  }, [f, clicked, frame.tap, last, frames.length, reduce, paused]);

  // звук и вибрация в момент «нажатия» — только если человек сам включил звук
  useEffect(() => {
    if (clicked && sound && !reduce) tapFeedback();
  }, [clicked, sound, reduce]);

  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.max(0.3, Math.min(1.15, (r.width - 16) / W, (r.height - 16) / H)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-12 items-center justify-center px-4 pt-3" aria-live="polite">
        <p key={f} className="animate-rise-in rounded-full bg-card px-4 py-1.5 text-center text-[13px] font-medium leading-snug text-foreground shadow-sm ring-1 ring-border">
          {captions[f]}
        </p>
      </div>
      <div ref={box} className="relative min-h-0 flex-1">
        <div
          className="absolute left-1/2 top-1/2 overflow-hidden rounded-[2.2rem] border-[5px] border-foreground/80 bg-background text-foreground shadow-2xl"
          style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}
          aria-hidden
        >
          {children(ui)}
          <div
            className="pointer-events-none absolute z-40 transition-[left,top] duration-[900ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{ left: `${frame.x}%`, top: `${frame.y}%`, opacity: reduce ? 0 : 1 }}
          >
            {frame.tap && <span key={f} className="absolute -left-5 -top-5 size-10 rounded-full bg-primary/50 animate-tap" style={{ animationDelay: "850ms" }} />}
            <Pointer />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ——— строительные блоки «скриншотов» ——— */

export function Screen({ title, right, children, className }: { title: string; right?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <div className="flex h-7 shrink-0 items-center justify-between px-6 text-[10px] font-semibold text-muted-foreground">
        <span>9:41</span>
        <span className="h-2 w-5 rounded-sm bg-muted-foreground/60" />
      </div>
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <b className="text-[17px] font-semibold tracking-tight">{title}</b>
        {right}
      </div>
      <div className={cn("min-h-0 flex-1 space-y-2 px-4 pt-2", className)}>{children}</div>
    </div>
  );
}

export function Bar({ className }: { className?: string }) {
  return <div className={cn("h-2 rounded-full bg-muted", className)} />;
}

export function Card({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>{children}</div>;
}

export function Btn({ children, className, tone = "primary" }: { children: ReactNode; className?: string; tone?: "primary" | "secondary" | "success" | "danger" }) {
  const tones = {
    primary: "bg-[linear-gradient(135deg,#8b5cf6,#d946ef_55%,#ec4899)] text-white",
    secondary: "border border-border bg-card text-foreground",
    success: "bg-success text-white dark:text-background",
    danger: "border border-danger/40 bg-danger-soft text-danger",
  };
  return <div className={cn("flex h-10 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold", tones[tone], className)}>{children}</div>;
}

export function Pill({ tone, children }: { tone: "success" | "info" | "danger" | "muted"; children: ReactNode }) {
  const tones = {
    success: "bg-success-soft text-success",
    info: "bg-primary/10 text-primary",
    danger: "bg-danger-soft text-danger",
    muted: "bg-muted text-muted-foreground",
  };
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold", tones[tone])}>{children}</span>;
}

/** Нижняя шторка с затемнением; появляется с анимацией при монтировании. */
export function Sheet({ top, title, children }: { top: number; title: string; children: ReactNode }) {
  return (
    <>
      <div className="absolute inset-0 z-[34] animate-fade-in bg-black/45" />
      <div className="absolute inset-x-0 bottom-0 z-[35] animate-sheet-up rounded-t-3xl border-t border-border bg-popover px-4 pt-2 shadow-2xl" style={{ top }}>
        <div className="mx-auto h-1 w-10 rounded-full bg-border" />
        <p className="mt-3 h-6 text-[15px] font-semibold">{title}</p>
        {children}
      </div>
    </>
  );
}

export function Field({ label, value, className }: { label: string; value?: string; className?: string }) {
  return (
    <div className={className}>
      <p className="h-4 text-[10px] font-medium text-muted-foreground">{label}</p>
      <div className="flex h-10 items-center rounded-lg border border-input bg-background px-3 text-[13px]">
        {value ? <span className="animate-fade-in">{value}</span> : <span className="h-2 w-16 rounded-full bg-muted" />}
      </div>
    </div>
  );
}
