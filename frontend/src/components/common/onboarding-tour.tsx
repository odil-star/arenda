import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, MousePointerClick, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSaveTourProgress } from "@/api/portal";
import { Button } from "@/components/ui/button";
import { overlayClass } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CoachMarks, COACH_TARGETS } from "./tour/coach-marks";
import { SCENES, type Scene } from "./tour/scenes";
import { Stage } from "./tour/stage";

export type TourKind = "tenant" | "landlord";

const TONES = [
  "from-violet-500 to-fuchsia-500",
  "from-sky-500 to-indigo-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-fuchsia-500 to-pink-500",
  "from-cyan-500 to-blue-500",
  "from-violet-500 to-purple-600",
];

const SOUND_KEY = "rent.tour.sound";
const SWIPE_PX = 56;

function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Показывать ли обучение само: один раз на аккаунт. Окно остаётся открытым, пока человек его не закроет,
 * даже если сервер уже отметил обучение пройденным (иначе оно пропадало бы на последнем шаге).
 */
export function useAutoTour(kind: TourKind, seen: string[] | undefined, ready: boolean) {
  const [open, setOpen] = useState(false);
  const [handled, setHandled] = useState(false);
  useEffect(() => {
    if (!ready || handled) return;
    setHandled(true);
    if (!(seen ?? []).includes(kind)) setOpen(true);
  }, [ready, handled, seen, kind]);
  return { open, close: useCallback(() => setOpen(false), []) };
}

/**
 * Большая модалка-обучение с анимированными «скриншотами»: курсор показывает, куда нажимать.
 * `forced` — нельзя закрыть и пропустить: только пройти все шаги до конца.
 * `skip` — шаги, которые уже не нужны (например, объект уже добавлен).
 * Прогресс сохраняется на сервере; на последнем шаге можно сразу показать те же кнопки на настоящем экране.
 */
export function OnboardingTour({
  kind,
  open,
  onClose,
  forced = false,
  skip = [],
}: {
  kind: TourKind;
  open: boolean;
  onClose: () => void;
  forced?: boolean;
  skip?: string[];
}) {
  const { t } = useTranslation();
  const save = useSaveTourProgress();
  const scenes = SCENES[kind] as Record<string, Scene>;
  const skipKey = skip.join(",");
  const keys = useMemo(() => Object.keys(scenes).filter((k) => !skipKey.split(",").includes(k)), [scenes, skipKey]);

  const [index, setIndex] = useState(0);
  const [reached, setReached] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replay, setReplay] = useState(0);
  const [sound, setSound] = useState(readSound);
  const [phase, setPhase] = useState<"modal" | "coach">("modal");
  const swipe = useRef<number | null>(null);

  const key = keys[Math.min(index, keys.length - 1)];
  const scene = scenes[key];
  const last = index === keys.length - 1;
  const base = `tour.${kind}.steps.${key}`;
  const tr = useCallback((k: string) => t(k as never) as string, [t]);
  const m = useCallback((k: string) => tr(`tour.mock.${k}`), [tr]);

  const go = useCallback(
    (to: number) => {
      const next = Math.max(0, Math.min(keys.length - 1, to));
      if (forced && next > reached + 1) return; // в обязательном обучении нельзя перепрыгнуть непройденные шаги
      setIndex(next);
      setPaused(false);
      if (next > reached) {
        setReached(next);
        save.mutate({ kind, step: next, done: false }); // аналитика: где люди останавливаются
      }
    },
    [forced, keys.length, kind, reached, save],
  );

  const finish = (withCoach: boolean) => {
    save.mutate({ kind, step: index, done: true });
    if (withCoach && COACH_TARGETS[kind].length) {
      setPhase("coach");
      return;
    }
    close();
  };

  const close = () => {
    setIndex(0);
    setReached(0);
    setPhase("modal");
    onClose();
  };

  const toggleSound = () =>
    setSound((v) => {
      try {
        localStorage.setItem(SOUND_KEY, v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") go(index + 1);
    else if (e.key === "ArrowLeft") go(index - 1);
  };
  const onPointerDown = (e: PointerEvent) => {
    swipe.current = e.clientX;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (swipe.current === null) return;
    const dx = e.clientX - swipe.current;
    swipe.current = null;
    if (dx <= -SWIPE_PX) go(index + 1);
    else if (dx >= SWIPE_PX) go(index - 1);
    else if (Math.abs(dx) < 8) setPaused((p) => !p); // лёгкое касание экрана — пауза / продолжить
  };

  if (phase === "coach") return open ? <CoachMarks targets={COACH_TARGETS[kind]} onClose={close} /> : null;

  const ctl = "flex size-9 items-center justify-center rounded-full bg-white/25 text-white backdrop-blur transition-colors hover:bg-white/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && !forced && finish(false)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(overlayClass, "bg-black/70")} />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          onEscapeKeyDown={(e) => forced && e.preventDefault()}
          onPointerDownOutside={(e) => forced && e.preventDefault()}
          onInteractOutside={(e) => forced && e.preventDefault()}
          className="fixed inset-x-0 bottom-0 z-50 flex h-[97dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none animate-sheet-up md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:h-[min(92dvh,780px)] md:max-w-5xl md:-translate-x-1/2 md:-translate-y-1/2 md:flex-row md:rounded-3xl md:animate-fade-in"
        >
          {/* сцена: экран телефона с курсором; свайп — переключает шаг, касание — пауза */}
          <div className={cn("relative flex min-h-0 flex-1 flex-col bg-gradient-to-br transition-colors duration-500 md:w-[55%] md:flex-none", TONES[index % TONES.length])}>
            <div key={`${kind}-${key}`} className="flex min-h-0 flex-1 animate-rise-in flex-col touch-pan-y" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
              <Stage key={replay} frames={scene.frames} captions={scene.frames.map((_, i) => tr(`${base}.f${i}`))} paused={paused} sound={sound}>
                {(f) => scene.render(f, m)}
              </Stage>
            </div>
            <div className="flex h-12 shrink-0 items-center justify-center gap-2 pb-2">
              <button type="button" className={ctl} onClick={() => setPaused((p) => !p)} aria-label={paused ? t("tour.play") : t("tour.pause")} title={paused ? t("tour.play") : t("tour.pause")}>
                {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
              </button>
              <button type="button" className={ctl} onClick={() => { setReplay((n) => n + 1); setPaused(false); }} aria-label={t("tour.replay")} title={t("tour.replay")}>
                <RotateCcw className="size-4" aria-hidden />
              </button>
              <button type="button" className={ctl} onClick={toggleSound} aria-pressed={sound} aria-label={sound ? t("tour.soundOff") : t("tour.soundOn")} title={sound ? t("tour.soundOff") : t("tour.soundOn")}>
                {sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
              </button>
            </div>
          </div>

          {/* текст и управление */}
          <div className="flex max-h-[50%] shrink-0 flex-col px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 md:max-h-none md:min-h-0 md:flex-1 md:px-8 md:pb-8 md:pt-8">
            <div key={key} className="min-h-0 flex-1 animate-rise-in space-y-2 overflow-y-auto md:space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("tour.step", { current: index + 1, total: keys.length })}</p>
              <DialogPrimitive.Title className="text-2xl font-semibold tracking-tight md:text-3xl">{tr(`${base}.title`)}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-[15px] leading-relaxed text-muted-foreground md:text-base">{tr(`${base}.text`)}</DialogPrimitive.Description>
              {last && COACH_TARGETS[kind].length > 0 && (
                <Button variant="secondary" className="mt-2" onClick={() => finish(true)}>
                  <MousePointerClick aria-hidden /> {t("tour.showOnScreen")}
                </Button>
              )}
            </div>

            <div className="flex justify-center gap-1 py-3 md:justify-start" role="tablist" aria-label={t("tour.label")}>
              {keys.map((k, i) => {
                const locked = forced && i > reached;
                return (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={i === index}
                    aria-label={t("tour.step", { current: i + 1, total: keys.length })}
                    disabled={locked}
                    onClick={() => go(i)}
                    className="group flex h-6 items-center px-0.5 disabled:cursor-not-allowed"
                  >
                    <span className={cn("h-1.5 rounded-full transition-all group-hover:bg-primary/70", i === index ? "w-7 bg-primary" : i <= reached ? "w-2 bg-primary/50" : "w-2 bg-border")} />
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              {index > 0 ? (
                <Button variant="secondary" size="lg" onClick={() => go(index - 1)} aria-label={t("tour.back")}>
                  <ChevronLeft aria-hidden />
                </Button>
              ) : (
                !forced && (
                  <Button variant="ghost" size="lg" onClick={() => finish(false)}>
                    {t("tour.skip")}
                  </Button>
                )
              )}
              <Button size="lg" className="flex-1" onClick={() => (last ? finish(false) : go(index + 1))}>
                {last ? t("tour.done") : t("tour.next")}
                {!last && <ChevronRight aria-hidden />}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
