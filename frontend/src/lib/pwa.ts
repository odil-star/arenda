import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";

/* ---------- Установка приложения (PWA) ---------- */

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// beforeinstallprompt приходит один раз и рано — запоминаем его на уровне модуля.
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    notify();
  }, []);

  const installed = isStandalone();
  return {
    installed,
    /** Браузер умеет ставить приложение сам (Chrome/Edge/Android). */
    canInstall: !installed && deferred !== null,
    /** iOS Safari: ставится только вручную через «Поделиться → На экран Домой». */
    needsIosHint: !installed && isIos() && deferred === null,
    install,
  };
}

/* ---------- Web Push ---------- */

function toKey(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = "loading" | "unsupported" | "disabled" | "blocked" | "off" | "on";

async function registration() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const reg = await registration();
    if (!reg) return setState("unsupported");
    try {
      const { data } = await api.get<{ enabled: boolean }>("/push/key/");
      if (!data.enabled) return setState("disabled");
    } catch {
      return setState("unsupported");
    }
    if (Notification.permission === "denied") return setState("blocked");
    setState((await reg.pushManager.getSubscription()) ? "on" : "off");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await registration();
      if (!reg) return;
      if ((await Notification.requestPermission()) !== "granted") return;
      const { data } = await api.get<{ public_key: string }>("/push/key/");
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(data.public_key) }));
      await api.post("/push/subscription/", sub.toJSON());
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [refresh]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const sub = await (await registration())?.pushManager.getSubscription();
      if (sub) {
        await api.delete("/push/subscription/", { data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [refresh]);

  return { state, busy, enable, disable };
}
