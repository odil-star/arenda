import {
  Building2, Check, ChevronLeft, ChevronRight, Copy, FileText, Headset, Home, Image as ImageIcon, Paperclip, Plus, Receipt, Send, UserRound, Users, Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Bar, Btn, Card, Field, hl, Pill, Screen, Sheet, type Frame } from "./stage";

export type M = (key: string) => string;
export interface Scene {
  frames: Frame[];
  render: (f: number, m: M) => ReactNode;
}

/* ——— общие части ——— */

function TopIcons({ ring }: { ring?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("flex size-8 items-center justify-center rounded-full", hl(!!ring))}>
        <Headset className="size-[18px]" />
      </span>
      <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">АК</span>
    </div>
  );
}

const TENANT_TABS = [Home, Wallet, FileText, UserRound] as const;
const TENANT_TAB_KEYS = ["home", "payments", "contract", "profile"] as const;

function TenantTabs({ active, ring = -1, m }: { active: number; ring?: number; m: M }) {
  return (
    <ul className="absolute inset-x-3 bottom-2 z-30 grid h-14 grid-cols-4 rounded-[1.6rem] border border-border bg-card/95 p-1 shadow-lg">
      {TENANT_TABS.map((Icon, i) => (
        <li key={i} className={cn("flex flex-col items-center justify-center gap-0.5 rounded-3xl text-[9px] font-medium", i === active ? "bg-accent text-foreground" : "text-muted-foreground", hl(i === ring))}>
          <Icon className="size-[18px]" />
          {m(TENANT_TAB_KEYS[i])}
        </li>
      ))}
    </ul>
  );
}

const LANDLORD_TAB_KEYS = ["home", "properties", null, "payments", "tenants"] as const;

function LandlordTabs({ active, ring = -1, m }: { active: number; ring?: number; m: M }) {
  const icons = [Home, Building2, Plus, Wallet, Users];
  return (
    <ul className="absolute inset-x-3 bottom-2 z-30 grid h-14 grid-cols-5 items-center rounded-full border border-border bg-card/95 p-1 shadow-lg">
      {icons.map((Icon, i) => {
        const key = LANDLORD_TAB_KEYS[i];
        return (
          <li key={i} className="flex justify-center">
            {key ? (
              <span className={cn("flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-full text-[8px] font-medium", i === active ? "bg-accent text-foreground" : "text-muted-foreground", hl(i === ring))}>
                <Icon className="size-[18px]" />
                {m(key)}
              </span>
            ) : (
              <span className={cn("flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md", hl(i === ring))}>
                <Icon className="size-5" strokeWidth={2.5} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Центры вкладок в % экрана (по оси X) и вертикаль нижней панели. */
const TAB_Y = 94;
const T4 = [15.5, 38.5, 61.5, 84.5];
const L5 = [13.2, 31.6, 50, 68.4, 86.8];

function PayRow({ month, tone, label, ring }: { month: string; tone: "success" | "info" | "danger"; label: string; ring?: boolean }) {
  return (
    <div className={cn("flex h-[58px] items-center justify-between rounded-xl border border-border bg-card px-3", hl(!!ring))}>
      <div>
        <p className="text-[13px] font-medium">{month}</p>
        <p className="text-[12px] tabular-nums text-muted-foreground">3 500 000</p>
      </div>
      <Pill tone={tone}>{label}</Pill>
    </div>
  );
}

/** Нарисованный банковский чек: вместо серой заглушки видно, что именно присылает жилец. */
function ReceiptArt({ m }: { m: M }) {
  return (
    <div className="relative flex h-[130px] items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800">
      <div className="w-[118px] -rotate-3 rounded-md bg-white px-3 py-2.5 text-slate-800 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="text-[8px] font-bold tracking-wide text-slate-500">BANK</span>
          <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="size-2.5" strokeWidth={3} /></span>
        </div>
        <p className="mt-1.5 text-[7px] text-slate-500">{m("paid")}</p>
        <p className="text-[13px] font-bold leading-4 tabular-nums">3 500 000</p>
        <div className="mt-2 space-y-1">
          <div className="h-1 w-full rounded bg-slate-200" />
          <div className="h-1 w-4/5 rounded bg-slate-200" />
          <div className="h-1 w-3/5 rounded bg-slate-200" />
        </div>
      </div>
    </div>
  );
}

function PhotoTile({ className }: { className: string }) {
  return (
    <span className={cn("flex size-8 items-center justify-center rounded-md bg-gradient-to-br text-white/90", className)}>
      <Home className="size-4" />
    </span>
  );
}

/* ——— чат поддержки (одинаков для обеих ролей) ——— */

function supportScene(kind: "tenant" | "landlord"): Scene {
  const Tabs = kind === "tenant" ? TenantTabs : LandlordTabs;
  return {
    frames: [
      { x: 78.7, y: 8.7, tap: true },
      { x: 45, y: 93.5, tap: true },
      { x: 88, y: 93.5, tap: true },
      { x: 60, y: 30 },
    ],
    render: (f, m) =>
      f === 0 ? (
        <>
          <Screen title={m("home")} right={<TopIcons ring />}>
            <Card><Bar className="w-20" /><div className="mt-3 h-8 w-40 rounded-md bg-muted" /><Bar className="mt-3 w-32" /></Card>
            <Bar className="w-24" />
            <Bar className="h-12 w-full rounded-xl" />
          </Screen>
          <Tabs active={0} m={m} />
        </>
      ) : (
        <Screen title={m("support")} right={<ChevronLeft className="size-5 text-muted-foreground" />}>
          <div className="mt-1 max-w-[78%] animate-fade-in rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-[12px]">{m("chatHello")}</div>
          {f === 3 && (
            <>
              <div className="ml-auto max-w-[78%] animate-fade-in rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-[12px] text-primary-foreground">{m("chatMsg")}</div>
              <div className="max-w-[78%] animate-fade-in rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-[12px]">{m("chatAnswer")}</div>
            </>
          )}
          <div className="absolute inset-x-3 bottom-3 flex h-11 items-center gap-2 rounded-full border border-input bg-card px-4 text-[12px]">
            <span className={cn("flex-1", f < 2 && "text-muted-foreground", f === 1 && "animate-pulse")}>{f === 2 ? m("chatMsg") : f === 3 ? "" : m("write")}</span>
            <span className={cn("flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground", hl(f === 2))}>
              <Send className="size-4" />
            </span>
          </div>
        </Screen>
      ),
  };
}

/* ——— жилец ——— */

function tenantHome(m: M, o: { ringCard?: boolean; ringBtn?: boolean; review?: boolean; ringRow?: boolean; copied?: boolean }) {
  return (
    <>
      <Screen title={m("hello")} right={<TopIcons />}>
        <Card className={cn("h-[156px]", hl(!!o.ringCard))}>
          <p className="h-4 text-[11px] font-medium text-muted-foreground">{m("due")}</p>
          <p className="mt-1 h-8 text-[26px] font-semibold leading-8 tabular-nums">3 500 000 <span className="text-[13px] font-medium text-muted-foreground">{m("sum")}</span></p>
          <p className="mt-1.5 h-4 text-[11px] text-muted-foreground">{m("dueNote")}</p>
          {o.review ? (
            <div className="mt-3 flex h-10 animate-pop items-center"><Pill tone="info">{m("onReview")}</Pill></div>
          ) : (
            <Btn className={cn("mt-3", hl(!!o.ringBtn))}>{m("pay")}</Btn>
          )}
        </Card>
        <p className="h-4 pt-1 text-[11px] font-medium text-muted-foreground">{m("next")}</p>
        <PayRow month={m("month2")} tone="info" label={m("soon")} ring={o.ringRow} />
      </Screen>
      <TenantTabs active={0} m={m} />
    </>
  );
}

const tenantHomeScene: Scene = {
  frames: [{ x: 50, y: 27 }, { x: 50, y: 34 }, { x: 50, y: 52 }],
  render: (f, m) => tenantHome(m, { ringCard: f === 0, ringBtn: f === 1, ringRow: f === 2 }),
};

const tenantPayScene: Scene = {
  frames: [{ x: 50, y: 34, tap: true }, { x: 84, y: 41, tap: true }, { x: 50, y: 59, tap: true }, { x: 50, y: 85, tap: true }, { x: 50, y: 27 }],
  render: (f, m) =>
    f === 0 || f === 4 ? (
      tenantHome(m, { ringBtn: f === 0, review: f === 4, ringCard: f === 4 })
    ) : (
      <>
        {tenantHome(m, {})}
        <Sheet top={150} title={m("payTitle")}>
          <Card className="mt-1 p-3">
            <p className="h-4 text-[10px] font-medium text-muted-foreground">{m("requisites")}</p>
            <div className="mt-1 flex h-9 items-center justify-between">
              <span className="text-[14px] font-semibold tabular-nums">8600 1234 5678 9012</span>
              <span className={cn("flex size-8 items-center justify-center rounded-lg", f === 1 ? hl(true) : "", f >= 2 ? "bg-success-soft text-success" : "bg-muted")}>
                {f >= 2 ? <Check className="size-4" /> : <Copy className="size-4" />}
              </span>
            </div>
            {f >= 2 && <p className="animate-fade-in text-[10px] font-medium text-success">{m("copied")}</p>}
          </Card>
          <div className={cn("mt-4 flex h-[60px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-input text-[12px] text-muted-foreground", f === 2 && hl(true), f >= 3 && "border-solid border-success/50 bg-success-soft text-success")}>
            {f >= 3 ? <><Check className="size-4" /> {m("fileName")}</> : <><Paperclip className="size-4" /> {m("attach")}</>}
          </div>
          <Btn className={cn("absolute inset-x-4 bottom-6", hl(f === 3))}>{m("send")}</Btn>
        </Sheet>
      </>
    ),
};

const tenantPaymentsScene: Scene = {
  frames: [{ x: T4[1], y: TAB_Y, tap: true }, { x: 50, y: 19 }, { x: 50, y: 30 }, { x: 50, y: 41 }],
  render: (f, m) =>
    f === 0 ? (
      <>
        <Screen title={m("home")} right={<TopIcons />}>
          <Card className="h-[156px]"><Bar className="w-16" /><div className="mt-3 h-8 w-36 rounded-md bg-muted" /></Card>
        </Screen>
        <TenantTabs active={0} ring={1} m={m} />
      </>
    ) : (
      <>
        <Screen title={m("payments")} right={<TopIcons />}>
          <PayRow month={m("month2")} tone="danger" label={m("due")} ring={f === 1} />
          <PayRow month={m("month1")} tone="info" label={m("onReview")} ring={f === 2} />
          <PayRow month={m("month0")} tone="success" label={m("paid")} ring={f === 3} />
          <PayRow month={m("month00")} tone="success" label={m("paid")} />
        </Screen>
        <TenantTabs active={1} m={m} />
      </>
    ),
};

const tenantContractScene: Scene = {
  frames: [{ x: T4[2], y: TAB_Y, tap: true }, { x: 50, y: 24 }, { x: 50, y: 50 }, { x: 50, y: 64 }],
  render: (f, m) =>
    f === 0 ? (
      <>
        <Screen title={m("home")} right={<TopIcons />}>
          <Card className="h-[156px]"><Bar className="w-16" /><div className="mt-3 h-8 w-36 rounded-md bg-muted" /></Card>
        </Screen>
        <TenantTabs active={0} ring={2} m={m} />
      </>
    ) : (
      <>
        <Screen title={m("contract")} right={<TopIcons />}>
          <Card className={cn("h-[132px]", hl(f === 1))}>
            <p className="h-4 text-[11px] text-muted-foreground">{m("rentLabel")}</p>
            <p className="h-8 text-[22px] font-semibold leading-8 tabular-nums">3 500 000 <span className="text-[12px] font-medium text-muted-foreground">{m("sum")}</span></p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full w-[62%] rounded-full bg-primary" /></div>
            <p className="mt-2 h-4 text-[11px] text-muted-foreground">{m("daysLeft")}</p>
          </Card>
          <div className={cn("h-[88px] rounded-xl border border-border bg-card p-3", hl(f === 2))}>
            <p className="text-[12px] font-semibold">{m("conditions")}</p>
            <Bar className="mt-2.5 w-full" /><Bar className="mt-2 w-3/4" /><Bar className="mt-2 w-1/2" />
          </div>
          <div className={cn("flex h-12 items-center justify-between rounded-xl border border-border bg-card px-3 text-[13px] font-medium", hl(f === 3))}>
            <span className="flex items-center gap-2"><ImageIcon className="size-4 text-muted-foreground" /> {m("photos")}</span>
            <span className="flex items-center gap-1.5">
              <PhotoTile className="from-sky-300 to-indigo-400" />
              <PhotoTile className="from-amber-300 to-orange-400" />
              <ChevronRight className="size-4 text-muted-foreground" />
            </span>
          </div>
        </Screen>
        <TenantTabs active={2} m={m} />
      </>
    ),
};

const tenantProfileScene: Scene = {
  frames: [{ x: T4[3], y: TAB_Y, tap: true }, { x: 50, y: 47 }, { x: 50, y: 69 }, { x: 50, y: 82 }],
  render: (f, m) =>
    f === 0 ? (
      <>
        <Screen title={m("home")} right={<TopIcons />}>
          <Card className="h-[156px]"><Bar className="w-16" /><div className="mt-3 h-8 w-36 rounded-md bg-muted" /></Card>
        </Screen>
        <TenantTabs active={0} ring={3} m={m} />
      </>
    ) : (
      <>
        <Screen title={m("profile")}>
          <Card className="flex h-16 items-center gap-3 p-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-[13px] font-semibold text-primary">АК</span>
            <div className="space-y-1.5"><Bar className="w-24 bg-foreground/20" /><Bar className="w-16" /></div>
          </Card>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {[m("contacts"), m("password")].map((t) => (
              <div key={t} className="flex h-12 items-center justify-between px-3 text-[13px]">{t}<ChevronRight className="size-4 text-muted-foreground" /></div>
            ))}
            <div className={cn("flex h-12 items-center justify-between px-3 text-[13px]", hl(f === 1))}>
              <span className="flex items-center gap-2"><Send className="size-4 text-primary" /> Telegram</span>
              <Pill tone="info">{m("connect")}</Pill>
            </div>
          </div>
          <div className="space-y-2 rounded-xl border border-border bg-card p-3">
            <p className="h-4 text-[11px] font-medium">{m("theme")}</p>
            <Seg items={[m("light"), m("dark"), m("system")]} active={f === 2 ? 1 : 0} ring={f === 2} />
            <p className="h-4 pt-1 text-[11px] font-medium">{m("language")}</p>
            <Seg items={["Русский", "Oʻzbekcha"]} active={f === 3 ? 1 : 0} ring={f === 3} />
          </div>
        </Screen>
        <TenantTabs active={3} m={m} />
      </>
    ),
};

function Seg({ items, active, ring }: { items: string[]; active: number; ring?: boolean }) {
  return (
    <div className={cn("grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1", hl(!!ring))}>
      {items.map((t, i) => (
        <span key={t} className={cn("flex h-7 items-center justify-center rounded-md text-[11px] font-medium transition-colors", i === active ? "bg-card shadow-sm" : "text-muted-foreground")}>{t}</span>
      ))}
    </div>
  );
}

const tenantWelcomeScene: Scene = {
  frames: [{ x: T4[0], y: TAB_Y }, { x: T4[1], y: TAB_Y, tap: true }, { x: T4[2], y: TAB_Y, tap: true }, { x: T4[3], y: TAB_Y, tap: true }, { x: T4[3], y: TAB_Y }],
  render: (u, m) => {
    const tab = Math.max(0, u - 1);
    const bodies = [
      <Card key="h" className="h-[156px]"><Bar className="w-16" /><div className="mt-3 h-8 w-36 rounded-md bg-muted" /><Btn className="mt-3">{m("pay")}</Btn></Card>,
      <div key="p" className="space-y-2">{[0, 1, 2].map((i) => <PayRow key={i} month={m(`month${i}`)} tone={i ? "success" : "info"} label={i ? m("paid") : m("onReview")} />)}</div>,
      <Card key="c" className="h-[132px]"><Bar className="w-24" /><div className="mt-3 h-8 w-32 rounded-md bg-muted" /></Card>,
      <Card key="u" className="flex h-16 items-center gap-3 p-3"><span className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-[13px] font-semibold text-primary">АК</span><Bar className="w-24" /></Card>,
    ];
    return (
      <>
        <Screen title={m(TENANT_TAB_KEYS[tab])} right={<TopIcons />}>{bodies[tab]}</Screen>
        <TenantTabs active={tab} ring={u} m={m} />
      </>
    );
  },
};

/* ——— арендодатель ——— */

function Stats({ m }: { m: M }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[[m("properties"), "3"], [m("tenants"), "3"], [m("payments"), "2"], [m("income"), "12M"]].map(([t, v]) => (
        <div key={t} className="h-[68px] rounded-xl border border-border bg-card p-3">
          <p className="h-4 text-[10px] text-muted-foreground">{t}</p>
          <p className="text-[20px] font-semibold leading-6 tabular-nums">{v}</p>
        </div>
      ))}
    </div>
  );
}

function LandlordHome({ m, ring = -1 }: { m: M; ring?: number }) {
  return (
    <>
      <Screen title={m("home")} right={<TopIcons />}>
        <Stats m={m} />
      </Screen>
      <LandlordTabs active={0} ring={ring} m={m} />
    </>
  );
}

function Empty({ m, label, ring }: { m: M; label: string; ring?: boolean }) {
  return (
    <div className="flex h-[300px] flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Receipt className="size-6" /></span>
      <p className="text-[12px] text-muted-foreground">{m("empty")}</p>
      <Btn className={cn("px-5", hl(!!ring))}>{label}</Btn>
    </div>
  );
}

const LANDLORD_WELCOME_TABS = [0, 1, 3, 4];
const landlordWelcomeScene: Scene = {
  frames: [{ x: L5[0], y: TAB_Y }, { x: L5[1], y: TAB_Y, tap: true }, { x: L5[3], y: TAB_Y, tap: true }, { x: L5[4], y: TAB_Y, tap: true }, { x: L5[2], y: TAB_Y }],
  render: (u, m) => {
    const tabIdx = LANDLORD_WELCOME_TABS[Math.min(3, Math.max(0, u - 1))];
    const ring = u >= 4 ? 2 : LANDLORD_WELCOME_TABS[u];
    const titles: Record<number, string> = { 0: "home", 1: "properties", 3: "payments", 4: "tenants" };
    const body =
      tabIdx === 0 ? <Stats m={m} /> :
      tabIdx === 1 ? <div className="space-y-2">{[0, 1].map((i) => <PayRow key={i} month={m("propNameVal")} tone="success" label={m("rented")} />)}</div> :
      tabIdx === 3 ? <div className="space-y-2">{[0, 1].map((i) => <PayRow key={i} month={m(`month${i}`)} tone={i ? "success" : "info"} label={i ? m("paid") : m("soon")} />)}</div> :
      <div className="space-y-2">{[0, 1].map((i) => <PayRow key={i} month={m("person")} tone="success" label={m("active")} />)}</div>;
    return (
      <>
        <Screen title={m(titles[tabIdx])} right={<TopIcons />}>{body}</Screen>
        <LandlordTabs active={tabIdx} ring={ring} m={m} />
      </>
    );
  },
};

function FormSheet({ m, kind, f }: { m: M; kind: "property" | "tenant"; f: number }) {
  return (
    <Sheet top={130} title={kind === "property" ? m("addProperty") : m("addTenant")}>
      <div className="space-y-3 pt-1">
        <Field label={kind === "property" ? m("propName") : m("tenantName")} value={f >= 2 ? (kind === "property" ? m("propNameVal") : m("person")) : undefined} />
        <Field label={kind === "property" ? m("propAddr") : m("tenantPhone")} value={f >= 2 ? (kind === "property" ? m("address") : "+998 90 123 45 67") : undefined} />
      </div>
      <Btn className={cn("absolute inset-x-4 bottom-6", hl(f === 2))}>{m("save")}</Btn>
    </Sheet>
  );
}

const landlordPropertiesScene: Scene = {
  frames: [{ x: L5[1], y: TAB_Y, tap: true }, { x: 50, y: 50, tap: true }, { x: 50, y: 85, tap: true }, { x: 50, y: 24 }],
  render: (f, m) => (
    <>
      <Screen title={f === 0 ? m("home") : m("properties")} right={<TopIcons />}>
        {f === 0 ? <Stats m={m} /> : f === 3 ? <PayRow month={m("propNameVal")} tone="success" label={m("free")} ring /> : <Empty m={m} label={m("addProperty")} ring={f === 1} />}
      </Screen>
      <LandlordTabs active={f === 0 ? 0 : 1} ring={f === 0 ? 1 : -1} m={m} />
      {f === 2 && <FormSheet m={m} kind="property" f={f} />}
    </>
  ),
};

const landlordTenantsScene: Scene = {
  frames: [{ x: L5[4], y: TAB_Y, tap: true }, { x: 50, y: 50, tap: true }, { x: 50, y: 85, tap: true }, { x: 80, y: 18, tap: true }, { x: 50, y: 75 }],
  render: (f, m) => (
    <>
      <Screen title={f === 0 ? m("home") : m("tenants")} right={<TopIcons />}>
        {f === 0 ? (
          <Stats m={m} />
        ) : f >= 3 ? (
          <div className="flex h-[58px] items-center justify-between rounded-xl border border-border bg-card px-3">
            <div>
              <p className="text-[13px] font-medium">{m("person")}</p>
              <p className="text-[11px] text-muted-foreground">+998 90 123 45 67</p>
            </div>
            {f === 4 ? <Pill tone="success">{m("invited")}</Pill> : <span className={cn("flex h-8 items-center rounded-lg bg-primary px-3 text-[11px] font-semibold text-primary-foreground", hl(true))}>{m("invite")}</span>}
          </div>
        ) : (
          <Empty m={m} label={m("addTenant")} ring={f === 1} />
        )}
      </Screen>
      <LandlordTabs active={f === 0 ? 0 : 4} ring={f === 0 ? 4 : -1} m={m} />
      {f === 2 && <FormSheet m={m} kind="tenant" f={f} />}
      {f === 4 && (
        <div className="absolute inset-x-4 bottom-24 z-30 flex animate-rise-in items-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-[12px] text-background shadow-xl">
          <Check className="size-4" /> {m("linkCopied")}
        </div>
      )}
    </>
  ),
};

const landlordLeaseScene: Scene = {
  frames: [{ x: 50, y: TAB_Y, tap: true }, { x: 50, y: 75, tap: true }, { x: 50, y: 33 }, { x: 50, y: 91, tap: true }, { x: 50, y: 28 }],
  render: (f, m) => {
    if (f >= 2 && f <= 3) {
      return (
        <Screen title={m("newLease")} right={<ChevronLeft className="size-5 text-muted-foreground" />}>
          <Field label={m("property")} value={m("propNameVal")} className={cn("rounded-lg", f === 2 && "")} />
          <Field label={m("tenant")} value={m("person")} />
          <div className="grid grid-cols-2 gap-2">
            <Field label={m("amount")} value="3 500 000" />
            <Field label={m("payDay")} value="5" />
          </div>
          <Btn className={cn("absolute inset-x-4 bottom-4", hl(f === 3))}>{m("create")}</Btn>
        </Screen>
      );
    }
    if (f === 4) {
      return (
        <Screen title={m("newLease")}>
          <div className="flex h-12 animate-pop items-center gap-2 rounded-xl bg-success-soft px-3 text-[13px] font-semibold text-success"><Check className="size-4" /> {m("scheduleDone")}</div>
          {[0, 1, 2].map((i) => <PayRow key={i} month={m(`month${i}`)} tone="info" label={m("soon")} ring={i === 0} />)}
        </Screen>
      );
    }
    return (
      <>
        <LandlordHome m={m} ring={f === 0 ? 2 : -1} />
        {f === 1 && (
          <Sheet top={380} title={m("create")}>
            {[m("newLease"), m("addTenant"), m("addProperty")].map((t, i) => (
              <div key={t} className={cn("flex h-12 items-center border-b border-border text-[13px] font-medium", i === 0 && "text-primary", i === 0 && hl(true))}>{t}</div>
            ))}
          </Sheet>
        )}
      </>
    );
  },
};

const landlordPaymentsScene: Scene = {
  frames: [{ x: L5[3], y: TAB_Y, tap: true }, { x: 83, y: 20, tap: true }, { x: 50, y: 20 }],
  render: (f, m) => (
    <>
      <Screen title={f === 0 ? m("home") : m("payments")} right={<TopIcons />}>
        {f === 0 ? (
          <Stats m={m} />
        ) : (
          <>
            <div className="flex h-[76px] items-center justify-between rounded-xl border border-border bg-card px-3">
              <div>
                <p className="text-[13px] font-medium">{m("person")}</p>
                <p className="text-[12px] tabular-nums text-muted-foreground">3 500 000</p>
              </div>
              {f === 2 ? <Pill tone="success">{m("paid")}</Pill> : <span className={cn("flex h-8 items-center rounded-lg border border-border px-2.5 text-[10px] font-semibold", hl(true))}>{m("markPaid")}</span>}
            </div>
            <PayRow month={m("month1")} tone="info" label={m("soon")} />
            <PayRow month={m("month0")} tone="success" label={m("paid")} />
          </>
        )}
      </Screen>
      <LandlordTabs active={f === 0 ? 0 : 3} ring={f === 0 ? 3 : -1} m={m} />
    </>
  ),
};

const landlordReceiptsScene: Scene = {
  frames: [{ x: 50, y: 28 }, { x: 29, y: 56, tap: true }, { x: 50, y: 28 }],
  render: (f, m) => (
    <>
      <Screen title={m("receipts")} right={<TopIcons />}>
        <Card className={cn("space-y-2 p-3", hl(f === 0))}>
          <ReceiptArt m={m} />
          <div className="flex h-10 items-center justify-between">
            <div>
              <p className="text-[13px] font-medium">{m("person")}</p>
              <p className="text-[12px] tabular-nums text-muted-foreground">3 500 000 {m("sum")}</p>
            </div>
            {f === 2 && <Pill tone="success">{m("confirmed")}</Pill>}
          </div>
          {f < 2 ? (
            <div className="grid grid-cols-2 gap-2">
              <Btn tone="success" className={hl(f === 1)}>{m("confirm")}</Btn>
              <Btn tone="danger">{m("reject")}</Btn>
            </div>
          ) : (
            <div className="flex h-10 animate-pop items-center justify-center gap-1.5 rounded-lg bg-success-soft text-[12px] font-semibold text-success"><Check className="size-4" /> {m("notified")}</div>
          )}
        </Card>
      </Screen>
      <LandlordTabs active={0} m={m} />
    </>
  ),
};

export const SCENES = {
  tenant: {
    welcome: tenantWelcomeScene,
    home: tenantHomeScene,
    pay: tenantPayScene,
    payments: tenantPaymentsScene,
    contract: tenantContractScene,
    support: supportScene("tenant"),
    profile: tenantProfileScene,
  },
  landlord: {
    welcome: landlordWelcomeScene,
    properties: landlordPropertiesScene,
    tenants: landlordTenantsScene,
    lease: landlordLeaseScene,
    payments: landlordPaymentsScene,
    receipts: landlordReceiptsScene,
    support: supportScene("landlord"),
  },
} as const satisfies Record<string, Record<string, Scene>>;
