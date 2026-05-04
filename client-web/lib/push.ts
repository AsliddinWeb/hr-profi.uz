/**
 * Web Push subscription helper.
 *
 * Flow:
 *   1. Fetch VAPID public key from `/notifications/push/public-key`.
 *   2. Use the registered service worker to call `pushManager.subscribe`.
 *   3. POST the resulting subscription to `/notifications/push/subscribe`.
 *
 * iOS note: Web Push works only when the PWA is installed via "Add to Home
 * Screen" on iOS 16.4+. On Android (Chrome/Edge/Firefox) it works in any
 * browser tab.
 */
import { api } from "./api";

export type PushPermission = "default" | "granted" | "denied";

export function pushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function pushPermission(): PushPermission {
  if (typeof Notification === "undefined") return "default";
  return Notification.permission as PushPermission;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Std = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Std);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buf: ArrayBuffer | null | undefined): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function getPublicKey(): Promise<string> {
  const r = await api.get<{ public_key: string }>(
    "/notifications/push/public-key"
  );
  return r.data.public_key;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  // Allow either an already-registered SW (production build) or register on
  // the fly so the dev build can also exercise the flow.
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js");
}

export async function subscribePush(): Promise<boolean> {
  if (!pushSupported()) return false;

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;

  const publicKey = await getPublicKey();
  if (!publicKey) return false;

  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    // Some TS lib versions type `applicationServerKey` as
    // `BufferSource | null` in strict mode; the Uint8Array generic mismatch
    // is an annotation issue, not a runtime one — cast to satisfy both.
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  const json = sub.toJSON() as {
    endpoint: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const p256dh = json.keys?.p256dh ?? arrayBufferToBase64(sub.getKey("p256dh"));
  const auth = json.keys?.auth ?? arrayBufferToBase64(sub.getKey("auth"));

  await api.post("/notifications/push/subscribe", {
    endpoint: json.endpoint,
    keys: { p256dh, auth },
    user_agent:
      typeof navigator !== "undefined" ? navigator.userAgent : null,
  });
  return true;
}

export async function unsubscribePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  try {
    await api.post("/notifications/push/unsubscribe", {
      endpoint: sub.endpoint,
      keys: {
        p256dh: arrayBufferToBase64(sub.getKey("p256dh")),
        auth: arrayBufferToBase64(sub.getKey("auth")),
      },
    });
  } catch {
    // best-effort
  }
  await sub.unsubscribe();
  return true;
}

export async function pushIsSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}
