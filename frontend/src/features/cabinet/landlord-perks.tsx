import { Check, Crown, Gem } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useTenantMe } from "@/api/portal";
import { cn } from "@/lib/utils";

const PRIME_PERKS = ["receipt", "support", "repairs48", "sms"] as const;
const VIP_PERKS = ["repairs24", "brand"] as const;
const SEEN_KEY = "landlord-perks-seen";

/** Показывали ли уже это окно этому жильцу для этого тарифа (помним на устройстве; при смене тарифа покажем снова один раз). */
function wasSeen(userId: number, tier: string): boolean {
  try {
    return localStorage.getItem(`${SEEN_KEY}:${userId}:${tier}`) === "1";
  } catch {
    return false;
  }
}

function markSeen(userId: number, tier: string) {
  try {
    localStorage.setItem(`${SEEN_KEY}:${userId}:${tier}`, "1");
  } catch {
    /* без сохранения окно покажется ещё раз — не страшно */
  }
}

/**
 * Окно «Преимущества от вашего арендодателя»: один раз при первом входе, если у арендодателя Prime или VIP
 * (у нескольких арендодателей берём высший тариф). Пока идёт обучение, ждём — два окна подряд не показываем.
 */
export function LandlordPerksModal({ suspended = false }: { suspended?: boolean }) {
  const { t } = useTranslation();
  const me = useTenantMe();
  const [dismissed, setDismissed] = useState(false);
  const tiers = me.data?.landlords.map((l) => l.landlord_tier) ?? [];
  const tier = tiers.includes("vip") ? "vip" : tiers.includes("prime") ? "prime" : null;
  const userId = me.data?.id;
  if (!tier || userId === undefined || dismissed || suspended || wasSeen(userId, tier)) return null;

  const vip = tier === "vip";
  // на VIP заявки напоминаются быстрее, поэтому «48 ч» заменяется на «24 ч»
  const perks = [...PRIME_PERKS.filter((k) => !(vip && k === "repairs48")), ...(vip ? VIP_PERKS : [])];
  const Icon = vip ? Crown : Gem;
  const close = () => {
    markSeen(userId, tier);
    setDismissed(true);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        title={
          <span className="flex items-center gap-2">
            <Icon className={cn("size-5", vip ? "text-warning" : "text-info")} aria-hidden />
            {t(vip ? "tenantPerks.titleVip" : "tenantPerks.titlePrime")}
          </span>
        }
        description={t("tenantPerks.hint")}
        className={cn("border-2", vip ? "border-warning" : "border-info")}
        footer={<Button onClick={close}>{t("tenantPerks.ok")}</Button>}
      >
        <ul className="space-y-3">
          {perks.map((key) => (
            <li key={key} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span>
                <span className="font-medium">{t(`tenantPerks.perks.${key}.title`)}</span>
                <span className="block text-muted-foreground">{t(`tenantPerks.perks.${key}.text`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
