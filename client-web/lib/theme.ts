/**
 * Theme management.
 *
 * Three modes: "system" (follow OS), "light", "dark". The selected mode is
 * persisted under ``wtp.client.theme`` so it survives reload. We attach
 * `.dark` to <html> when the resolved theme is dark — Tailwind's
 * ``darkMode: 'class'`` strategy then takes over.
 *
 * Why a custom hook instead of `next-themes`? We're already small (one
 * Zustand store + one i18n init) and prefer to keep the bundle tight. A
 * MediaQueryList listener handles "system" properly.
 */
"use client";

import { useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "wtp.client.theme";
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
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  // Update the meta theme-color so Android/iOS chrome blends in.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? "#0b1220" : "#4f46e5");
  }
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

/** Resolved theme for UI badges (Sun/Moon icons that follow "system"). */
export function useResolvedTheme(): "light" | "dark" {
  const mode = useThemeMode();
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => undefined;
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => cb();
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    },
    () => resolve(mode),
    () => "light"
  );
}

/** Run on app boot — apply the persisted mode and follow system changes. */
export function initTheme() {
  if (typeof window === "undefined") return;
  applyToDocument(readMode());
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", () => {
    if (readMode() === "system") applyToDocument("system");
  });
}
