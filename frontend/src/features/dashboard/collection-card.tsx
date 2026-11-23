import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Card } from "@/components/ui/card";
import type { Dashboard } from "@/api/types";
import { todayISO, useFormat } from "@/lib/format";
import { useCountUp, usePrefersReducedMotion } from "@/lib/hooks";
import { cn, toNumber } from "@/lib/utils";
import { Delta } from "./insights";

function StoryLine({ icon: Icon, tone, children }: { icon: typeof Clock; tone: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", tone)}>
        <Icon className="size-3" aria-hidden />
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Кольцо «собрано / осталось» (Recharts) с процентом в центре. */
function CollectionRing({ percent, received, rest }: { percent: number; received: number; rest: number }) {
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const shown = useCountUp(percent);
  // дорожку рисуем отдельно (статичный SVG), в Pie — только полученная доля
  const data = [
    { key: "received", value: received || (rest ? 0 : 1) },
    { key: "rest", value: received || !rest ? rest : 1 },
  ];

  return (
    <figure className="relative size-28 shrink-0 sm:size-40 [&_.recharts-pie]:[filter:drop-shadow(0_0_10px_var(--glow))]" aria-label={t("dashboard.progressLabel", { percent })}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
        <circle cx="50" cy="50" r="44.5" fill="none" stroke="var(--track)" strokeWidth="11" />
      </svg>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius="78%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            stroke="none"
            cornerRadius={received && rest ? 8 : 0}
            paddingAngle={received && rest ? 3 : 0}
            isAnimationActive={!reduced}
            animationDuration={900}
          >
            <Cell fill="var(--primary)" />
            <Cell fill="transparent" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <figcaption className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-semibold tabular tracking-tight sm:text-3xl">{shown}%</span>
        <span className="text-xs text-muted-foreground">{t("dashboard.collected")}</span>
      </figcaption>
    </figure>
  );
}

function ReceivedSummary({ month, received, expected, prevReceived }: { month: string; received: number; expected: number; prevReceived?: number }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  return (
    <>
      <p className="text-sm font-medium text-muted-foreground">{t("dashboard.receivedIn", { month })}</p>
      <p className="mt-1 font-display text-[28px] font-semibold leading-tight tracking-tight tabular sm:text-4xl">
        {fmt.money(received)}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground tabular">
        {t("dashboard.ofExpected", { amount: fmt.money(expected) })}
        {prevReceived !== undefined && <Delta now={received} prev={prevReceived} className="ml-2" />}
      </p>
    </>
  );
}

/** Главная карточка: сколько собрано за месяц и что это значит — словами. */
export function CollectionCard({ data }: { data: Dashboard }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const expected = toNumber(data.month.expected);
  const received = toNumber(data.month.received);
  const rest = Math.max(0, expected - received);
  const percent = expected > 0 ? Math.min(100, Math.round((received / expected) * 100)) : 0;
  const receivedShown = useCountUp(received);
  const prevReceived = toNumber(data.prev_month?.received ?? 0);
  const month = fmt.month(todayISO());

  return (
    <Card className="relative overflow-hidden">
      {/* орнамент в углу — едва заметный, только декор */}
      {/* мягкое мятное свечение в углу (в светлой теме --glow прозрачный) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,var(--glow),transparent_45%)] opacity-70"
      />

      <div className="relative p-5 sm:flex sm:items-center sm:gap-8 sm:p-6">
        <div className="flex items-center gap-5 sm:contents">
          <CollectionRing percent={percent} received={received} rest={rest} />
          <div className="min-w-0 sm:hidden">
            <ReceivedSummary month={month} received={receivedShown} expected={expected} prevReceived={prevReceived} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="hidden sm:block">
            <ReceivedSummary month={month} received={receivedShown} expected={expected} prevReceived={prevReceived} />
          </div>

          <ul className="mt-5 space-y-2 text-sm sm:mt-4">
            {expected === 0 ? (
              <StoryLine icon={Clock} tone="bg-neutral-soft text-neutral">
                {t("dashboard.story.noCharges")}
              </StoryLine>
            ) : rest > 0 ? (
              <StoryLine icon={Clock} tone="bg-info-soft text-info">
                {t("dashboard.story.rest", { amount: fmt.money(rest) })}
              </StoryLine>
            ) : (
              <StoryLine icon={CheckCircle2} tone="bg-success-soft text-success">
                {t("dashboard.story.allCollected")}
              </StoryLine>
            )}
            {data.overdue.count > 0 ? (
              <StoryLine icon={AlertCircle} tone="bg-danger-soft text-danger">
                {t("dashboard.story.overdue", { count: data.overdue.count, amount: fmt.money(data.overdue.amount) })}
              </StoryLine>
            ) : (
              <StoryLine icon={CheckCircle2} tone="bg-success-soft text-success">
                {t("dashboard.story.noOverdue")}
              </StoryLine>
            )}
          </ul>
        </div>
      </div>
    </Card>
  );
}
