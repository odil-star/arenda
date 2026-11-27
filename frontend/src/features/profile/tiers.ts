import type { Subscription, Tier } from "@/api/types";

export const TIER_ORDER: readonly Tier[] = ["free", "prime", "vip"];

/** soon — возможность ещё не включена: показываем честно, а не продаём как готовую. */
export type PerkKey =
  | "unlimited" | "pdf" | "telegram" | "receipts" | "reports" | "media" | "listings"
  | "sms" | "brand" | "digest" | "boost" | "storage" | "priority"
  | "manager" | "team" | "screening" | "featured" | "whitelabel" | "integrations";

export interface Perk {
  key: PerkKey;
  soon?: boolean;
}

/**
 * Free — всё, что есть в продукте сейчас (активно у всех).
 * Prime и VIP только добавляют; тексты — в locales: tiers.perks.<key>.
 */
export const TIER_PERKS: Record<Tier, readonly Perk[]> = {
  free: [
    { key: "unlimited" }, { key: "pdf" }, { key: "telegram" }, { key: "receipts" },
    { key: "reports" }, { key: "media" }, { key: "listings" },
  ],
  prime: [
    { key: "sms" }, { key: "brand" }, { key: "digest" }, { key: "boost" }, { key: "priority" },
    { key: "storage", soon: true },
  ],
  vip: [
    { key: "manager" }, { key: "featured" }, { key: "whitelabel" }, { key: "integrations" }, { key: "team" },
    { key: "screening" },
  ],
};

export function tierOf(sub: Subscription | undefined): Tier {
  return sub?.tier ?? "free";
}

/** Хватает ли тарифа для возможности уровня `minimum` — для гейтинга эксклюзивных функций на клиенте. */
export function hasTier(sub: Subscription | undefined, minimum: Tier): boolean {
  return TIER_ORDER.indexOf(tierOf(sub)) >= TIER_ORDER.indexOf(minimum);
}
