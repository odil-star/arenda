import { BellRing, CalendarCheck, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandMark } from "@/components/layout/brand";

/** Левая панель экрана входа (только десктоп): бренд, орнамент и три причины пользоваться сервисом. */
export function AuthHero() {
  const { t } = useTranslation();
  const points = [
    { icon: Wallet, text: t("auth.hero.point1") },
    { icon: BellRing, text: t("auth.hero.point2") },
    { icon: CalendarCheck, text: t("auth.hero.point3") },
  ];

  return (
    <aside className="relative hidden overflow-hidden border-r border-border bg-card text-foreground lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-14">
      <div aria-hidden className="ornament pointer-events-none absolute inset-0 bg-primary opacity-[0.08]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_80%,var(--glow)_0%,transparent_55%),radial-gradient(ellipse_at_50%_50%,transparent_20%,var(--card)_80%)]"
      />

      <div className="relative flex items-center gap-3">
        <BrandMark className="size-10" />
        <span className="font-display text-xl font-semibold tracking-tight">{t("app.name")}</span>
      </div>

      <div className="relative max-w-md">
        <p className="font-display text-[34px] font-semibold leading-[1.15] tracking-tight xl:text-[40px]">
          {t("auth.hero.title")}
        </p>
        <ul className="mt-8 space-y-4">
          {points.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-[15px] leading-snug text-muted-foreground">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="pt-1">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-sm text-muted-foreground">{t("auth.hero.footer")}</p>
    </aside>
  );
}
