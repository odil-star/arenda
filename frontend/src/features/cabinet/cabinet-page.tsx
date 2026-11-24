import { AnnouncementBanner } from "@/components/layout/announcement-banner";
import { Headset } from "lucide-react";
import { useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Avatar } from "@/components/common/avatar";
import { Brand } from "@/components/layout/brand";
import { GlassIndicator } from "@/components/layout/glass-indicator";
import { useGlassDrag } from "@/components/layout/use-glass-drag";
import { DocIcon, HomeIcon, UserIcon, WalletIcon, type TabIconProps } from "@/components/layout/nav-icons";
import { useTenantLeases, useTenantMe, useTenantPayments } from "@/api/portal";
import { useSupportUnread } from "@/api/support";
import { MediaNotifications } from "@/features/media/tenant-media";
import { cn } from "@/lib/utils";
import { groupPayments } from "./cabinet-logic";
import { ContractTab } from "./contract-tab";
import { HomeTab } from "./home-tab";
import { PaymentsTab } from "./payments-tab";
import { OnboardingTour, useAutoTour } from "@/components/common/onboarding-tour";
import { ProfileTab } from "./profile-tab";

type Tab = "home" | "payments" | "contract" | "profile";

const TABS: { id: Tab; icon: ComponentType<TabIconProps> }[] = [
  { id: "home", icon: HomeIcon },
  { id: "payments", icon: WalletIcon },
  { id: "contract", icon: DocIcon },
  { id: "profile", icon: UserIcon },
];

/** Кабинет жильца: главная, платежи, договор, профиль. Оплата — переводом + чек на проверку арендодателю. */
export function CabinetPage() {
  const { t } = useTranslation();
  const me = useTenantMe();
  const leases = useTenantLeases();
  const payments = useTenantPayments();
  const [params, setParams] = useSearchParams();
  // Обучение: при первом входе открывается само (помним на сервере), позже — по кнопке в профиле.
  const [tourRequested, setTourRequested] = useState(false);
  const auto = useAutoTour("tenant", me.data?.tours_seen, !!me.data && !!leases.data);
  const tourOpen = tourRequested || auto.open;
  // жильцу без договоров показывать оплату и договор пока нечем
  const tourSkip = leases.data && leases.data.length === 0 ? ["pay", "contract"] : [];
  const raw = params.get("tab");
  const tab: Tab = TABS.some((x) => x.id === raw) ? (raw as Tab) : "home";
  const setTab = (id: Tab) => {
    setParams(id === "home" ? {} : { tab: id }, { replace: true });
    window.scrollTo({ top: 0 });
  };

  const tabIndex = TABS.findIndex((x) => x.id === tab);
  const drag = useGlassDrag(TABS.length, (i) => {
    if (i !== tabIndex) setTab(TABS[i].id);
  });
  const shown = drag.hover ?? tabIndex;

  const name = [me.data?.first_name, me.data?.last_name].filter(Boolean).join(" ") || me.data?.landlords[0]?.full_name || me.data?.phone || me.data?.email || "";
  const title = tab === "home" ? (me.data?.first_name || name ? t("cabinet.hello", { name: me.data?.first_name || name }) : t("cabinet.title")) : t(`cabinet.tab.${tab}`);
  const supportUnread = useSupportUnread().data ?? 0;
  const dueCount = payments.data ? groupPayments(payments.data).due.filter((p) => p.can_pay).length : 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 pb-32">
      <header className="flex h-14 items-center justify-between">
        <Brand variant="house" />
        <div className="flex items-center gap-1">
        <Link
          to="/cabinet/support"
          data-tour="support"
          aria-label={supportUnread > 0 ? `${t("support.title")} (${t("support.unreadCount", { count: supportUnread })})` : t("support.title")}
          className="relative flex size-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Headset className="size-[22px]" aria-hidden />
          {supportUnread > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white tabular-nums dark:text-background">
              {supportUnread}
            </span>
          )}
        </Link>
        {name && tab !== "profile" && (
          <button
            type="button"
            onClick={() => setTab("profile")}
            aria-label={t("cabinet.tab.profile")}
            className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Avatar name={name} />
          </button>
        )}
        </div>
      </header>

      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>

      {tab === "home" && (
        <>
          <AnnouncementBanner />
          <MediaNotifications />
        </>
      )}

      <main className="flex flex-col gap-6">
        {tab === "home" && <HomeTab payments={payments.data} leases={leases.data} />}
        {tab === "payments" && <PaymentsTab all={payments.data} leases={leases.data} />}
        {tab === "contract" && <ContractTab leases={leases.data} />}
        {tab === "profile" && <ProfileTab me={me.data} name={name} onTour={() => setTourRequested(true)} />}
      </main>

      {tourOpen && (
        <OnboardingTour
          kind="tenant"
          open
          skip={tourSkip}
          onClose={() => {
            setTourRequested(false);
            auto.close();
          }}
        />
      )}

      <nav aria-label={t("cabinet.nav")} className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <ul ref={drag.ref} {...drag.handlers} style={{ touchAction: "none" }} className="liquid-glass pointer-events-auto relative mx-auto grid select-none max-w-md grid-cols-4 rounded-[1.75rem] p-1.5">
          <GlassIndicator index={drag.pos ?? tabIndex} count={TABS.length} dragging={drag.pos !== null} className="rounded-3xl" />
          {TABS.map(({ id, icon: Icon }, i) => {
            const active = shown === i;
            return (
              <li key={id}>
                <button
                  type="button"
                  data-tour={`tab-${id}`}
                  aria-current={tab === id ? "page" : undefined}
                  onClick={() => setTab(id)}
                  className={cn(
                    "relative flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-3xl text-muted-foreground transition-[color,transform] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                    active && "text-foreground",
                  )}
                >
                  <Icon className="size-6" solid={active} aria-hidden />
                  <span className="text-[11px] font-medium leading-none">{t(`cabinet.tab.${id}`)}</span>
                  {id === "payments" && dueCount > 0 && (
                    <span className="absolute top-1.5 left-1/2 ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white tabular-nums dark:text-background">
                      {dueCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
