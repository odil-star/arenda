import { Building2, FileSignature, FileText, Globe, Megaphone, Plus, UserPlus, Wallet, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface QuickAction {
  to: string;
  icon: LucideIcon;
  labelKey:
    | "quick.newLease"
    | "quick.newProperty"
    | "quick.newTenant"
    | "quick.markPayment"
    | "quick.allLeases"
    | "quick.newAd"
    | "quick.myAds";
  hintKey?: "quick.newLeaseHint" | "quick.markPaymentHint" | "quick.newAdHint";
  primary?: boolean;
}

/** Быстрые действия. ?new=1 открывает форму создания на странице раздела. */
const ACTIONS: readonly QuickAction[] = [
  { to: "/leases/new", icon: FileSignature, labelKey: "quick.newLease", hintKey: "quick.newLeaseHint", primary: true },
  { to: "/payments?tab=overdue", icon: Wallet, labelKey: "quick.markPayment", hintKey: "quick.markPaymentHint" },
  { to: "/ads/new", icon: Megaphone, labelKey: "quick.newAd", hintKey: "quick.newAdHint" },
  { to: "/ads", icon: Globe, labelKey: "quick.myAds" },
  { to: "/properties?new=1", icon: Building2, labelKey: "quick.newProperty" },
  { to: "/tenants?new=1", icon: UserPlus, labelKey: "quick.newTenant" },
  { to: "/leases", icon: FileText, labelKey: "quick.allLeases" },
];

/** Центральная кнопка «+» нижней навигации: шторка с быстрыми действиями. */
export function QuickActionsButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("quick.title")}
        aria-haspopup="dialog"
        className="relative z-10 flex size-14 -translate-y-3.5 items-center justify-center rounded-full border border-white/30 bg-primary bg-[linear-gradient(180deg,rgba(255,255,255,0.4),transparent_60%)] text-primary-foreground shadow-[0_8px_24px_var(--glow),inset_0_1px_0_rgba(255,255,255,0.35)] ring-4 ring-background/40 transition-transform active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Plus className="size-6" strokeWidth={2.5} aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t("quick.title")}>
          <ul className="space-y-2">
            {ACTIONS.map(({ to, icon: Icon, labelKey, hintKey, primary }) => (
              <li key={to}>
                <button
                  type="button"
                  onClick={() => go(to)}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted",
                    primary && "border-primary/40 bg-accent hover:bg-accent/80",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground",
                      primary && "bg-primary text-primary-foreground",
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{t(labelKey)}</span>
                    {hintKey && <span className="block text-xs text-muted-foreground">{t(hintKey)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
