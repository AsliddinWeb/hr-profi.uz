/**
 * Theme management for admin-web. Mirrors the client-web hook so the two
 * surfaces behave identically — the admin who flips dark mode on the PWA
 * gets the same look on the desktop panel without further setup.
 *
 * Three modes: "system" (follow OS), "light", "dark". Persisted under
 * ``hrp.admin.theme`` (separate from the PWA's ``wtp.client.theme`` key
 * so an admin tab and an employee tab can disagree on the same browser).
 */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "hrp.admin.theme";
export type ThemeMode = "system" | "light" | "dark";

let listeners: (() => void)[] = [];

function readMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
  if (v === "system" || v === "light" || v === "dark") return v;
  return "system";
}

function emit() {
  listeners.forEach((l) => l());
}

function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyToDocument(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const resolved = resolve(mode);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function setThemeMode(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, mode);
  applyToDocument(mode);
  emit();
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(
    (cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    () => readMode(),
    () => "system"
  );
}

/** Run on app boot — apply the persisted mode + follow system changes. */
export function initTheme() {
  if (typeof window === "undefined") return;
  applyToDocument(readMode());
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", () => {
    if (readMode() === "system") applyToDocument("system");
  });
}
