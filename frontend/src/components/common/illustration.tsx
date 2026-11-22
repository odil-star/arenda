import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Линейные иллюстрации для пустых состояний и ошибок.
 * Цвета — из токенов темы: мягкая заливка (accent), линия (accent-foreground),
 * «золотые» детали (sand) перекликаются с орнаментом.
 */

export type IllustrationName = "home" | "people" | "document" | "coins" | "celebrate" | "search" | "offline" | "lost";

const S = { stroke: "var(--accent-foreground)", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;
const SOFT = "var(--accent)";
const SAND = "var(--sand)";

function Sparkle({ x, y, r = 4 }: { x: number; y: number; r?: number }) {
  return <path d={`M${x} ${y - r}v${2 * r}M${x - r} ${y}h${2 * r}`} stroke={SAND} strokeWidth={1.8} strokeLinecap="round" />;
}

function Star({ x, y, s = 7 }: { x: number; y: number; s?: number }) {
  return (
    <g stroke={SAND} strokeWidth={1.4} fill="none">
      <rect x={x - s} y={y - s} width={2 * s} height={2 * s} />
      <rect x={x - s} y={y - s} width={2 * s} height={2 * s} transform={`rotate(45 ${x} ${y})`} />
    </g>
  );
}

const drawings: Record<IllustrationName, ReactNode> = {
  home: (
    <>
      <ellipse cx="80" cy="66" rx="58" ry="38" fill={SOFT} />
      <path {...S} d="M52 58 80 36l28 22" />
      <path {...S} d="M58 54v32h44V54" />
      <path {...S} d="M74 86V70h12v16" />
      <rect {...S} x="64" y="58" width="9" height="8" rx="1" />
      <rect {...S} x="88" y="58" width="9" height="8" rx="1" />
      <Star x={124} y={30} s={6} />
      <Sparkle x={36} y={34} />
    </>
  ),
  people: (
    <>
      <ellipse cx="80" cy="66" rx="58" ry="38" fill={SOFT} />
      <circle {...S} cx="66" cy="50" r="10" />
      <path {...S} d="M48 86c0-11 8-19 18-19s18 8 18 19" />
      <circle {...S} cx="98" cy="54" r="8" />
      <path {...S} d="M86 86c1-9 6-15 13-15s13 6 13 15" />
      <Star x={122} y={28} s={6} />
      <Sparkle x={38} y={40} />
    </>
  ),
  document: (
    <>
      <ellipse cx="80" cy="66" rx="58" ry="38" fill={SOFT} />
      <path {...S} d="M60 30h30l12 12v46H60z" />
      <path {...S} d="M90 30v12h12" />
      <path {...S} d="M68 52h24M68 60h24M68 68h14" />
      <path stroke={SAND} strokeWidth={2} strokeLinecap="round" fill="none" d="M68 80c4-5 7 3 10-1s5-3 8 0" />
      <Star x={124} y={34} s={6} />
      <Sparkle x={38} y={36} />
    </>
  ),
  coins: (
    <>
      <ellipse cx="80" cy="66" rx="58" ry="38" fill={SOFT} />
      <ellipse {...S} cx="72" cy="78" rx="18" ry="6" />
      <path {...S} d="M54 78v-8c0 3 8 6 18 6s18-3 18-6v8" />
      <ellipse {...S} cx="72" cy="62" rx="18" ry="6" />
      <path {...S} d="M54 62v8M90 62v8" />
      <circle {...S} cx="104" cy="46" r="12" />
      <path {...S} d="m98 46 4 4 8-8" />
      <Sparkle x={40} y={40} />
      <Star x={128} y={76} s={5} />
    </>
  ),
  celebrate: (
    <>
      <ellipse cx="80" cy="66" rx="58" ry="38" fill={SOFT} />
      <Star x={80} y={60} s={16} />
      <circle cx="80" cy="60" r="5" fill={SAND} />
      <path {...S} d="m70 92 10-8 10 8" />
      <Sparkle x={40} y={38} r={5} />
      <Sparkle x={122} y={36} />
      <Sparkle x={124} y={84} r={3} />
    </>
  ),
  search: (
    <>
      <ellipse cx="80" cy="66" rx="58" ry="38" fill={SOFT} />
      <path {...S} d="M50 42h34M50 52h24M50 62h30M50 72h18" />
      <circle {...S} cx="98" cy="64" r="14" />
      <path {...S} d="m108 74 12 12" />
      <path {...S} d="m93 59 10 10M103 59 93 69" />
      <Sparkle x={122} y={34} />
    </>
  ),
  offline: (
    <>
      <ellipse cx="80" cy="66" rx="58" ry="38" fill={SOFT} />
      <path {...S} d="M58 78h46a14 14 0 0 0 0-28 20 20 0 0 0-38-4 14 14 0 0 0-8 32" />
      <path stroke="var(--danger)" strokeWidth={2.2} strokeLinecap="round" d="M50 34l60 52" />
      <Sparkle x={124} y={32} />
    </>
  ),
  lost: (
    <>
      <ellipse cx="80" cy="66" rx="58" ry="38" fill={SOFT} />
      <path {...S} d="M80 90s-20-18-20-34a20 20 0 0 1 40 0c0 16-20 34-20 34z" />
      <path {...S} d="M75 52a5 5 0 1 1 7 5c-2 1-2 2-2 4" />
      <circle cx="80" cy="67" r="1.6" fill="var(--accent-foreground)" />
      <Star x={124} y={34} s={6} />
    </>
  ),
};

export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  return (
    <svg viewBox="0 0 160 112" className={cn("h-28 w-40", className)} aria-hidden>
      {drawings[name]}
    </svg>
  );
}
