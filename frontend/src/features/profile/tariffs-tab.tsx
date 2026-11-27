import { Check, ChevronDown, Crown, Gem, Gift, Hourglass, Lock, UserRoundCheck, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Subscription, Tier } from "@/api/types";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TIER_ORDER, TIER_PERKS, tierOf, type Perk } from "./tiers";

const ICONS: Record<Tier, LucideIcon> = { free: Gift, prime: Gem, vip: Crown };
const ACCENT: Record<Tier, string> = {
  free: "text-muted-foreground bg-muted",
  prime: "text-info bg-info-soft",
  vip: "text-warning bg-warning-soft",
};
const ADDED_IN: Partial<Record<Tier, "tiers.groupPrime" | "tiers.groupVip">> = {
  prime: "tiers.groupPrime",
  vip: "tiers.groupVip",
};

function TierIcon({ tier, className }: { tier: Tier; className?: string }) {
  const Icon = ICONS[tier];
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full", ACCENT[tier], className)}>
      <Icon className="size-1/2" aria-hidden />
    </span>
  );
}

function PerkList({ perks, locked }: { perks: readonly Perk[]; locked?: boolean }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-3">
      {perks.map((perk) => (
        <li key={perk.key} className="flex items-start gap-2.5 text-sm">
          {perk.soon ? (
            <Hourglass className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : locked ? (
            <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          )}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 font-medium">
              {t(`tiers.perks.${perk.key}.title`)}
              {perk.soon && <span className="text-xs font-normal text-warning">{t("tiers.soon")}</span>}
            </span>
            <span className="block text-muted-foreground">{t(`tiers.perks.${perk.key}.text`)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Шкала Free → Prime → VIP: пройденные уровни закрашены, текущий подписан «Вы здесь», верхние можно выбрать для просмотра. */
function Ladder({ current, preview, onPreview }: { current: Tier; preview: Tier | undefined; onPreview: (tier: Tier) => void }) {
  const { t } = useTranslation();
  const currentIdx = TIER_ORDER.indexOf(current);
  const progress = (currentIdx / (TIER_ORDER.length - 1)) * 100;

  return (
    <div role="group" aria-label={t("tiers.ladder")} className="relative pt-2">
      <div className="absolute inset-x-[16.6%] top-[2.25rem] h-1 rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
      </div>
      <ol className="relative grid grid-cols-3">
        {TIER_ORDER.map((tier, idx) => {
          const reached = idx <= currentIdx;
          const isCurrent = idx === currentIdx;
          const selectable = idx > currentIdx;
          const selected = selectable && tier === preview;
          const body = (
            <>
              <TierIcon
                tier={tier}
                className={cn(
                  "size-14 ring-4 ring-card transition-shadow",
                  !reached && "opacity-60",
                  isCurrent && "outline-2 outline-offset-2 outline-primary",
                  selected && "opacity-100 outline-2 outline-offset-2 outline-border",
                )}
              />
              <span className="font-display text-base font-semibold">{t(`tiers.${tier}.name`)}</span>
              {isCurrent ? (
                <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">{t("tiers.youAreHere")}</span>
              ) : (
                <span className="hidden text-center text-xs text-muted-foreground sm:block">{t(`tiers.${tier}.tagline`)}</span>
              )}
            </>
          );
          return (
            <li key={tier} className="flex justify-center" aria-current={isCurrent ? "step" : undefined}>
              {selectable ? (
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onPreview(tier)}
                  className="flex flex-col items-center gap-2 rounded-xl px-2 pb-1 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {body}
                </button>
              ) : (
                <div className="flex flex-col items-center gap-2 px-2 pb-1">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Раздел «Тариф»: лестница уровней, что есть сейчас и что откроется на выбранном следующем уровне. */
export function TariffsTab({ subscription }: { subscription?: Subscription }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const current = tierOf(subscription);
  const currentIdx = TIER_ORDER.indexOf(current);
  const higher = TIER_ORDER.slice(currentIdx + 1);
  const [picked, setPicked] = useState<Tier | undefined>(undefined);
  const preview = picked && higher.includes(picked) ? picked : higher[0];

  const lower = TIER_ORDER.slice(0, currentIdx);
  const lowerCount = lower.reduce((n, tier) => n + TIER_PERKS[tier].length, 0);
  // Всё, что добавится при переходе на выбранный уровень, по шагам: Prime, затем VIP.
  const unlockSteps = preview ? TIER_ORDER.slice(currentIdx + 1, TIER_ORDER.indexOf(preview) + 1) : [];

  return (
    <div className="space-y-6">
      <Card className="space-y-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm text-muted-foreground">
            {t("tiers.yourPlan")}: <span className="font-semibold text-foreground">{t(`tiers.${current}.name`)}</span>
          </p>
          {subscription?.expired ? (
            <p className="text-sm text-warning">
              {t("tiers.expired", { name: subscription.name ?? "", date: subscription.paid_until ? fmt.date(subscription.paid_until) : "" })}
            </p>
          ) : (
            current !== "free" &&
            subscription?.paid_until && <p className="text-sm font-medium">{t("tiers.paidUntil", { date: fmt.date(subscription.paid_until) })}</p>
          )}
        </div>
        <Ladder current={current} preview={preview} onPreview={setPicked} />
      </Card>

      <div className="grid items-start gap-6 md:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Check className="size-5 text-success" aria-hidden /> {t("tiers.haveNow")}
          </h3>
          <PerkList perks={TIER_PERKS[current]} />
          {lower.length > 0 && (
            <details className="group rounded-lg bg-muted/60 px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium">
                {t("tiers.alsoFrom", { tier: t(`tiers.${lower[lower.length - 1]}.name`) })}
                <span className="flex items-center gap-1 text-muted-foreground">
                  {lowerCount}
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
                </span>
              </summary>
              <div className="pt-3">
                <PerkList perks={lower.flatMap((tier) => TIER_PERKS[tier])} />
              </div>
            </details>
          )}
          {current === "vip" && (
            <div className="rounded-lg bg-warning-soft p-3 text-sm">
              <p className="flex items-center gap-1.5 font-medium text-warning">
                <UserRoundCheck className="size-4" aria-hidden /> {t("tiers.manager.title")}
              </p>
              <p className="mt-1 text-muted-foreground">
                {subscription?.manager
                  ? [subscription.manager.name, subscription.manager.contact].filter(Boolean).join(" · ")
                  : t("tiers.manager.pending")}
              </p>
            </div>
          )}
        </Card>

        {preview ? (
          <Card className="space-y-4 border-dashed p-5">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <TierIcon tier={preview} className="size-7" /> {t("tiers.unlocks", { tier: t(`tiers.${preview}.name`) })}
            </h3>
            {unlockSteps.map((step) => (
              <div key={step} className="space-y-3">
                {unlockSteps.length > 1 && ADDED_IN[step] && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(ADDED_IN[step])}</p>
                )}
                <PerkList perks={TIER_PERKS[step]} locked />
              </div>
            ))}
            <div className="space-y-2 border-t border-border pt-4">
              <Button asChild variant="primary" className="w-full">
                <Link to="/support">{t("tiers.connect", { tier: t(`tiers.${preview}.name`) })}</Link>
              </Button>
              <p className="text-center text-xs text-muted-foreground">{t("tiers.howToConnect")}</p>
            </div>
          </Card>
        ) : (
          <Card className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <TierIcon tier="vip" className="size-10" /> {t("tiers.allIncluded")}
          </Card>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{t("tiers.freeNote")}</p>
    </div>
  );
}
