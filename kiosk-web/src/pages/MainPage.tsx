import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Clock,
  DoorOpen,
  Keyboard,
  LogIn,
  LogOut,
  Search,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CameraPreview, type CameraHandle } from "@/components/CameraPreview";
import { LangSwitcher } from "@/components/LangSwitcher";
import { fmtDuration } from "@/lib/format";
import { speak } from "@/lib/speech";
import { useAuthStore } from "@/stores/auth";
import type {
  KioskAttendanceResponse,
  KioskEmployee,
  KioskEmployeeList,
  KioskMeResponse,
  KioskRecognizeResponse,
} from "@/lib/types";

/* Kiosk flow:
 *
 *   ┌──────────────┬──────────────┐    The idle screen is the
 *   │              │              │    operator's home: two
 *   │    KELISH    │    KETISH    │    huge tappable tiles.
 *   │   (check-in) │  (check-out) │
 *   │              │              │
 *   └──────────────┴──────────────┘
 *
 * Tapping a tile transitions ``mode`` from ``idle`` to ``in`` or
 * ``out``, which mounts the camera, starts the recognize loop, and
 * shows a cancel button. After a successful match (or a rejection)
 * the kiosk returns to idle automatically. The camera is *only* alive
 * while we're scanning — saves CPU + thermals + battery on the tablet
 * and avoids the privacy/legal weirdness of an always-on camera.
 *
 * Direction is taken from the mode the operator selected (not
 * inferred from ``employee.is_currently_in``), so a kiosk hit by an
 * already-checked-in person who taps Kelish will get an
 * "already_checked_in" error from the server — surfaced as a red
 * overlay. The opposite for Ketish without an active check-in. */

// Recognize loop cadence. Bumped down from 1200 ms once the backend
// face pipeline got faster (480 px cap + upsample=0 → ~40-70 ms per
// call instead of 150). 600 ms keeps the next frame ready to fire the
// moment the previous response lands, so the perceived wait at the
// kiosk drops noticeably without queuing on the worker.
const RECOGNIZE_INTERVAL_MS = 600;
// After firing a check on someone, ignore their face for this long
// so they don't get re-fired as they linger to read the success overlay.
const PER_EMPLOYEE_COOLDOWN_MS = 30_000;
// How many consecutive low-confidence frames we tolerate before
// surfacing a red "not recognized" overlay. One frame is jittery —
// the operator may have blinked or turned slightly. After the third
// in a row it's almost certainly a stranger / un-enrolled employee.
const REJECT_AFTER_FAILURES = 3;
// How long to keep the red rejection overlay on screen.
const REJECT_OVERLAY_MS = 3000;

type Direction = "IN" | "OUT";
type Mode = "idle" | "in" | "out";

// Inactivity timer — if the operator picks IN/OUT but never shows
// their face, return to idle after this so the camera doesn't stay
// powered indefinitely.
const SCAN_TIMEOUT_MS = 30_000;
// How long the success overlay stays before we return to idle. Kept
// short on purpose — Face-ID terminals at office entrances flash for
// ~1 s and immediately go back to idle so the next person can step
// up without staring at someone else's name.
const SUCCESS_DWELL_MS = 1500;

export function MainPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const setKiosk = useAuthStore((s) => s.setKiosk);
  const logout = useAuthStore((s) => s.logout);

  const meQ = useQuery({
    queryKey: ["kiosk-me"],
    queryFn: async () => (await api.get<KioskMeResponse>("/kiosks/me")).data,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (meQ.data?.kiosk) setKiosk(meQ.data.kiosk);
  }, [meQ.data?.kiosk, setKiosk]);

  const employeesQ = useQuery({
    queryKey: ["kiosk-employees"],
    queryFn: async () =>
      (await api.get<KioskEmployeeList>("/kiosks/me/employees", { params: { limit: 500 } }))
        .data,
    refetchInterval: 30_000,
  });

  const cameraRef = useRef<CameraHandle | null>(null);

  const [mode, setMode] = useState<Mode>("idle");
  const [manualOpen, setManualOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmEmp, setConfirmEmp] = useState<KioskEmployee | null>(null);
  // ``optimistic`` shows the green overlay the *instant* the server
  // returns a match, before /checkin completes. Refined into ``result``
  // when the mutation lands so the late/overtime pills appear.
  const [optimistic, setOptimistic] = useState<{
    employee: KioskEmployee;
    direction: Direction;
  } | null>(null);
  const [result, setResult] = useState<{
    response: KioskAttendanceResponse;
    direction: Direction;
  } | null>(null);
  // Red "not recognized" overlay when face is detected but doesn't
  // match anyone enrolled (after N consecutive low-confidence frames).
  const [rejectShown, setRejectShown] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastMatchName, setLastMatchName] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const items = employeesQ.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        (e.employee_code ?? "").toLowerCase().includes(q)
    );
  }, [employeesQ.data, search]);

  /* ---------- Mutation: fire a check-in/out ----------------------- */

  const checkMut = useMutation({
    mutationFn: async (payload: {
      employee: KioskEmployee;
      direction: Direction;
      withSelfie: boolean;
    }) => {
      const path =
        payload.direction === "IN"
          ? "/kiosks/me/checkin"
          : "/kiosks/me/checkout";
      const image_base64 = payload.withSelfie
        ? cameraRef.current?.captureFrame() ?? null
        : null;
      const r = await api.post<KioskAttendanceResponse>(path, {
        employee_id: payload.employee.id,
        image_base64,
      });
      return { response: r.data, direction: payload.direction };
    },
    onSuccess: (r) => {
      setConfirmEmp(null);
      setManualOpen(false);
      setOptimistic(null);
      setResult(r);
      qc.invalidateQueries({ queryKey: ["kiosk-employees"] });
    },
    onError: (e) => {
      setOptimistic(null);
      setErrorMsg(apiErrorMessage(e, t("errors.generic")));
      // Audible fail too — operator knows immediately something went
      // wrong without staring at the screen.
      speak("Failed", "en");
    },
  });

  // After a successful check-in/out, leave the green overlay visible
  // for a moment so the operator can read the time, then drop both
  // the overlay AND the scanning mode so the kiosk returns to idle.
  useEffect(() => {
    if (!result) return;
    const id = window.setTimeout(() => {
      setResult(null);
      setMode("idle");
    }, SUCCESS_DWELL_MS);
    return () => window.clearTimeout(id);
  }, [result]);

  // Auto-clear error toast.
  useEffect(() => {
    if (!errorMsg) return;
    const id = window.setTimeout(() => setErrorMsg(null), 4000);
    return () => window.clearTimeout(id);
  }, [errorMsg]);

  // Clear "last match" hint after a few seconds so it doesn't linger.
  useEffect(() => {
    if (!lastMatchName) return;
    const id = window.setTimeout(() => setLastMatchName(null), 3500);
    return () => window.clearTimeout(id);
  }, [lastMatchName]);

  /* ---------- Auto face-recognize loop ---------------------------- */

  const cooldownRef = useRef<Map<string, number>>(new Map());
  const recognizingRef = useRef(false);
  // Track consecutive low-confidence frames so we can show a single
  // red "not recognized" overlay instead of one per tick.
  const lowConfidenceStreakRef = useRef(0);

  useEffect(() => {
    // Loop only runs while the operator has explicitly chosen
    // ``in`` or ``out`` — the camera is mounted at the same time
    // (see render) so the loop never tries to capture frames from a
    // detached video element.
    if (mode === "idle") return;
    if (confirmEmp || result || optimistic || rejectShown || manualOpen) return;
    if (!employeesQ.data?.items?.length) return;

    const direction: Direction = mode === "in" ? "IN" : "OUT";
    let cancelled = false;

    async function tick() {
      if (cancelled || recognizingRef.current) return;
      const frame = cameraRef.current?.captureFrame();
      if (!frame) return;
      recognizingRef.current = true;
      setScanning(true);
      try {
        const r = await api.post<KioskRecognizeResponse>(
          "/kiosks/me/recognize",
          { image_base64: frame }
        );
        if (cancelled) return;

        if (r.data.matched && r.data.match) {
          lowConfidenceStreakRef.current = 0;
          const emp = r.data.match.employee;
          const last = cooldownRef.current.get(emp.id) ?? 0;
          if (Date.now() - last < PER_EMPLOYEE_COOLDOWN_MS) {
            // Cooldown — recognised again while standing at the
            // kiosk. Re-greet (voice) but DON'T fire another DB
            // write: for IN we keep the first record, for OUT the
            // backend's natural multi-row + last_check_out logic
            // handles "latest scan wins" (each tap from idle creates
            // a fresh OUT row, and the daily summary picks the
            // latest one). Bumping the cooldown stamp keeps the
            // greet-only branch active while they linger.
            cooldownRef.current.set(emp.id, Date.now());
            const firstName = emp.full_name.split(" ")[0] ?? emp.full_name;
            speak(`Thank you, ${firstName}`, "en");
            setLastMatchName(emp.full_name);
            return;
          }
          cooldownRef.current.set(emp.id, Date.now());
          // Optimistic UI: green overlay + voice the moment the match
          // lands. /checkin runs in parallel and swaps in the final
          // overlay (with late/overtime pills) when it returns.
          //
          // Voice is intentionally English regardless of the UI
          // language — most installed TTS engines speak English well,
          // and a curt "Thank you, {name}" reads cleanly in a noisy
          // office whatever the operator's locale is. Long localised
          // sentences sound robotic.
          setOptimistic({ employee: emp, direction });
          const firstName = emp.full_name.split(" ")[0] ?? emp.full_name;
          speak(`Thank you, ${firstName}`, "en");
          checkMut.mutate({ employee: emp, direction, withSelfie: true });
        } else if (r.data.reason === "low_confidence") {
          lowConfidenceStreakRef.current += 1;
          if (lowConfidenceStreakRef.current >= REJECT_AFTER_FAILURES) {
            lowConfidenceStreakRef.current = 0;
            setRejectShown(true);
            speak("Authentication failed", "en");
          }
        } else {
          lowConfidenceStreakRef.current = 0;
        }
      } catch {
        // Network blip / aborted — next tick will retry.
      } finally {
        recognizingRef.current = false;
        if (!cancelled) setScanning(false);
      }
    }

    const id = window.setInterval(tick, RECOGNIZE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    mode,
    confirmEmp,
    result,
    optimistic,
    rejectShown,
    manualOpen,
    employeesQ.data,
    checkMut,
    t,
    i18n.language,
  ]);

  // Auto-dismiss the rejection overlay AND drop back to idle so the
  // operator can re-tap the right button if they meant to.
  useEffect(() => {
    if (!rejectShown) return;
    const id = window.setTimeout(() => {
      setRejectShown(false);
      setMode("idle");
    }, REJECT_OVERLAY_MS);
    return () => window.clearTimeout(id);
  }, [rejectShown]);

  // If the operator taps a tile but never shows their face, we don't
  // want the camera spinning forever. Bail back to idle after the
  // timeout — only counts elapsed time *while in scan mode* and resets
  // each time the operator changes mode.
  useEffect(() => {
    if (mode === "idle") return;
    const id = window.setTimeout(() => setMode("idle"), SCAN_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [mode]);

  /* ---------- Manual selection helpers ---------------------------- */

  function pickManual(emp: KioskEmployee) {
    setConfirmEmp(emp);
  }

  function handleLogout() {
    if (window.confirm(t("main.logout_confirm"))) logout();
  }

  const me = meQ.data;
  const offline = meQ.isError;

  /* --------------------------------------------------------------- */

  return (
    <div className="flex h-full w-full flex-col bg-[var(--page-bg)]">
      <Header
        branchName={me?.branch.name ?? "..."}
        kioskName={me?.kiosk.name ?? "..."}
        companyName={me?.company.name ?? ""}
        companyLogo={me?.company.logo_url ?? null}
        offline={offline}
        onLogout={handleLogout}
      />

      {mode === "idle" ? (
        <IdleSplit onPick={setMode} />
      ) : (
        <ScanView
          mode={mode}
          cameraRef={cameraRef}
          scanning={scanning}
          lastMatchName={lastMatchName}
          onCancel={() => setMode("idle")}
          onManual={() => setManualOpen(true)}
        />
      )}

      {/* Manual selection drawer */}
      {manualOpen && (
        <ManualSheet
          employees={filtered}
          search={search}
          onSearch={setSearch}
          loading={employeesQ.isLoading}
          onPick={pickManual}
          onClose={() => {
            setManualOpen(false);
            setSearch("");
          }}
        />
      )}

      {/* Confirm modal (only manual flow uses it; auto-mode skips
          confirmation since the face match itself is the confirmation.) */}
      {confirmEmp && (
        <ConfirmModal
          employee={confirmEmp}
          // In manual flow we still honour the IN/OUT the operator
          // already picked on the idle screen; if they came in via the
          // (rare) idle → manual path with no mode set, fall back to
          // the employee's current state.
          direction={mode === "out" ? "OUT" : mode === "in" ? "IN" : confirmEmp.is_currently_in ? "OUT" : "IN"}
          submitting={checkMut.isPending}
          onCancel={() => setConfirmEmp(null)}
          onConfirm={() => {
            const direction: Direction =
              mode === "out"
                ? "OUT"
                : mode === "in"
                  ? "IN"
                  : confirmEmp.is_currently_in
                    ? "OUT"
                    : "IN";
            checkMut.mutate({
              employee: confirmEmp,
              direction,
              withSelfie: mode !== "idle",
            });
          }}
        />
      )}

      {/* Optimistic overlay — shows the moment a match lands, before
          /checkin comes back. Identical visuals to the final overlay
          but without the late/overtime pills. Replaced in-place by
          ``result`` once the mutation lands. */}
      {optimistic && !result && (
        <ResultOverlay
          optimistic
          result={{
            response: {
              employee: optimistic.employee,
              check_type: optimistic.direction === "IN" ? "CHECK_IN" : "CHECK_OUT",
              timestamp: new Date().toISOString(),
              is_late: false,
              late_minutes: 0,
              overtime_minutes: 0,
            },
            direction: optimistic.direction,
          }}
          onClose={() => setOptimistic(null)}
        />
      )}

      {result && <ResultOverlay result={result} onClose={() => setResult(null)} />}

      {/* Red "not recognized" overlay — fires after N consecutive
          low-confidence frames. Auto-dismisses; clicking dismisses
          early so the auto-loop resumes. */}
      {rejectShown && (
        <RejectOverlay onClose={() => setRejectShown(false)} />
      )}

      {errorMsg && (
        <div className="fixed left-1/2 top-6 z-50 inline-flex max-w-md -translate-x-1/2 items-center gap-3 rounded-xl bg-rose-600 px-5 py-3 text-base font-medium text-white shadow-lg ring-1 ring-rose-700">
          <span className="flex-1">{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="rounded-md p-0.5 text-white/80 hover:bg-white/15 hover:text-white"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

    </div>
  );
}

/* ================================================================
 *  Header
 * ================================================================ */

function Header({
  branchName,
  kioskName,
  companyName,
  companyLogo,
  offline,
  onLogout,
}: {
  branchName: string;
  kioskName: string;
  companyName: string;
  companyLogo: string | null;
  offline: boolean;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="topbar">
      <div className="flex min-w-0 items-center gap-3">
        {companyLogo ? (
          <img
            src={companyLogo}
            alt={companyName}
            className="size-11 shrink-0 rounded-xl object-cover ring-1 ring-[var(--card-border)] shadow-sm"
          />
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
            <Building2 className="size-5" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-base font-bold leading-tight text-ink-900">
            {companyName}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-ink-500">
            <span className="inline-flex items-center rounded-md bg-ink-100 px-1.5 py-0.5 font-semibold text-ink-700">
              {branchName}
            </span>
            <span className="opacity-60">·</span>
            <span className="truncate">
              {t("main.footer_kiosk")}: {kioskName}
            </span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {offline && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200"
            title={t("offline.title") ?? undefined}
          >
            <WifiOff className="size-3.5" />
            {t("offline.title")}
          </span>
        )}
        <div className="hidden items-center gap-2 rounded-xl bg-ink-50 px-3 py-1.5 sm:inline-flex">
          <Clock className="size-4 text-ink-500" />
          <LiveClock />
        </div>
        <LangSwitcher />
        <button
          type="button"
          onClick={onLogout}
          className="ml-1 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-500 transition hover:bg-rose-50 hover:text-rose-700"
          title={t("main.logout") ?? undefined}
        >
          <LogOut className="size-4" />
          <span className="hidden sm:inline">{t("main.logout")}</span>
        </button>
      </div>
    </header>
  );
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-sm font-semibold tabular-nums text-ink-700">
      {now.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}
    </span>
  );
}

/* ================================================================
 *  Manual sheet (slides up from the bottom)
 * ================================================================ */

function ManualSheet({
  employees,
  search,
  onSearch,
  loading,
  onPick,
  onClose,
}: {
  employees: KioskEmployee[];
  search: string;
  onSearch: (s: string) => void;
  loading: boolean;
  onPick: (e: KioskEmployee) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // Sort: currently-in first (so on-duty employees are easy to find for a
  // checkout), then alphabetical.
  const sorted = useMemo(() => {
    return [...employees].sort((a, b) => {
      if (a.is_currently_in !== b.is_currently_in) {
        return a.is_currently_in ? -1 : 1;
      }
      return a.full_name.localeCompare(b.full_name);
    });
  }, [employees]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-ink-900/40 backdrop-blur-sm">
      <div
        className="flex-1"
        onClick={onClose}
        aria-hidden
      />
      <div className="flex h-[78%] flex-col overflow-hidden rounded-t-3xl border-t border-[var(--card-border)] bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--card-border)] px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-ink-900">
              {t("main.manual_title")}
            </h2>
            <p className="text-xs text-ink-500">{t("main.manual_subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-ink-500 hover:bg-ink-100"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="shrink-0 border-b border-[var(--card-border)] bg-white p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute inset-y-0 left-4 my-auto size-5 text-ink-400" />
            <input
              type="search"
              autoFocus
              className="w-full rounded-xl border-0 bg-ink-50 py-3.5 pl-12 pr-4 text-base ring-1 ring-inset ring-[var(--card-border)] transition placeholder:text-ink-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder={t("main.search_placeholder") ?? ""}
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
          {loading ? (
            <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={i}>
                  <div className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-3 ring-1 ring-[var(--card-border)]">
                    <div className="size-16 animate-pulse rounded-full bg-ink-100" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-ink-100" />
                  </div>
                </li>
              ))}
            </ul>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-ink-100 text-ink-400">
                <UserRound className="size-7" />
              </span>
              <p className="text-sm font-medium text-ink-600">
                {t("main.no_employees")}
              </p>
              <p className="max-w-[260px] text-xs text-ink-400">
                {t("main.no_employees_hint")}
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4">
              {sorted.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onPick(e)}
                    className="emp-card w-full"
                  >
                    <Avatar emp={e} />
                    <p className="line-clamp-2 text-sm font-semibold leading-tight text-ink-900">
                      {e.full_name}
                    </p>
                    <p className="line-clamp-1 text-[11px] text-ink-500">
                      {e.position ?? e.department_name ?? e.employee_code ?? ""}
                    </p>
                    <span
                      className={cn(
                        "mt-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        e.is_currently_in
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-ink-100 text-ink-500"
                      )}
                    >
                      {e.is_currently_in
                        ? t("main.currently_in")
                        : t("main.currently_out")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
 *  Confirm modal
 * ================================================================ */

function ConfirmModal({
  employee,
  direction,
  submitting,
  onCancel,
  onConfirm,
}: {
  employee: KioskEmployee;
  direction: Direction;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const isIn = direction === "IN";
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/60 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5">
        <header
          className={cn(
            "flex items-center gap-2 px-5 py-3",
            isIn ? "bg-emerald-50" : "bg-amber-50"
          )}
        >
          <span className={cn(isIn ? "pill-in" : "pill-out")}>
            {isIn ? t("confirm.title_in") : t("confirm.title_out")}
          </span>
        </header>
        <div className="p-5">
          <div className="flex items-center gap-4 rounded-2xl border border-[var(--card-border)] bg-ink-50 p-4">
            <Avatar emp={employee} large />
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-ink-900">
                {employee.full_name}
              </p>
              <p className="truncate text-sm text-ink-500">
                {employee.position ?? employee.department_name ?? ""}
              </p>
              {employee.employee_code && (
                <p className="mt-0.5 truncate font-mono text-[11px] text-ink-400">
                  {employee.employee_code}
                </p>
              )}
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={onCancel}
              disabled={submitting}
            >
              {t("confirm.cancel")}
            </button>
            <button
              type="button"
              className={cn(
                "btn-primary flex-1",
                !isIn && "bg-amber-600 hover:bg-amber-700"
              )}
              onClick={onConfirm}
              disabled={submitting}
            >
              {isIn ? t("confirm.confirm_in") : t("confirm.confirm_out")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
 *  Success overlay
 * ================================================================ */

function ResultOverlay({
  result,
  optimistic,
  onClose,
}: {
  result: { response: KioskAttendanceResponse; direction: Direction };
  optimistic?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isIn = result.direction === "IN";
  const r = result.response;
  const gradient = isIn
    ? "bg-gradient-to-br from-emerald-500 via-emerald-600 to-emerald-700"
    : "bg-gradient-to-br from-amber-500 via-amber-600 to-amber-700";
  return (
    <div
      className={cn(
        "fixed inset-0 z-40 flex flex-col items-center justify-center p-6 text-center",
        gradient
      )}
      onClick={onClose}
    >
      <div className="flex size-36 items-center justify-center rounded-full bg-white/20 shadow-xl ring-8 ring-white/30 backdrop-blur">
        <span className="text-7xl drop-shadow-lg">{isIn ? "✓" : "↓"}</span>
      </div>
      <h2 className="mt-6 text-4xl font-extrabold text-white drop-shadow-lg sm:text-5xl">
        {isIn ? t("result.success_in") : t("result.success_out")}
      </h2>
      <div className="mt-7 flex items-center gap-5 rounded-3xl bg-white/15 px-7 py-5 shadow-lg ring-1 ring-white/20 backdrop-blur-md">
        <Avatar emp={r.employee} large />
        <div className="text-left">
          <p className="text-2xl font-bold text-white drop-shadow">
            {r.employee.full_name}
          </p>
          {optimistic ? (
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-base font-medium text-white/80">
              <span className="size-1.5 rounded-full bg-white live-dot" />
              {t("result.saving")}
            </p>
          ) : (
            <p className="mt-0.5 font-mono text-lg tabular-nums text-white/80">
              {new Date(r.timestamp).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </p>
          )}
        </div>
      </div>
      {!optimistic && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {r.is_late && (
            <span className="rounded-full bg-rose-700/90 px-4 py-2 text-sm font-semibold text-white shadow ring-1 ring-white/20">
              ⏰ {t("result.late", { minutes: fmtDuration(r.late_minutes) })}
            </span>
          )}
          {r.overtime_minutes > 0 && (
            <span className="rounded-full bg-indigo-700/90 px-4 py-2 text-sm font-semibold text-white shadow ring-1 ring-white/20">
              ⏱ {t("result.overtime", { minutes: fmtDuration(r.overtime_minutes) })}
            </span>
          )}
        </div>
      )}
      {!optimistic && (
        <p className="mt-10 text-sm font-medium text-white/70">
          {t("result.tap_anywhere")}
        </p>
      )}
    </div>
  );
}

function RejectOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-gradient-to-br from-rose-500 via-rose-600 to-rose-700 p-6 text-center"
      onClick={onClose}
    >
      <div className="flex size-36 items-center justify-center rounded-full bg-white/20 shadow-xl ring-8 ring-white/30 backdrop-blur">
        <span className="text-7xl drop-shadow-lg">×</span>
      </div>
      <h2 className="mt-6 text-4xl font-extrabold text-white drop-shadow-lg sm:text-5xl">
        {t("result.fail_title")}
      </h2>
      <p className="mt-4 max-w-md text-lg text-white/85">
        {t("result.fail_hint")}
      </p>
      <p className="mt-10 text-sm font-medium text-white/70">
        {t("result.tap_anywhere")}
      </p>
    </div>
  );
}

/* ================================================================
 *  Avatar
 * ================================================================ */

function Avatar({ emp, large = false }: { emp: KioskEmployee; large?: boolean }) {
  const sizeCls = large ? "size-20" : "size-16";
  const textCls = large ? "text-3xl" : "text-2xl";
  if (emp.photo_url) {
    return (
      <img
        src={emp.photo_url}
        alt={emp.full_name}
        className={cn(
          sizeCls,
          "shrink-0 rounded-full object-cover ring-2 ring-white shadow-md"
        )}
        loading="lazy"
      />
    );
  }
  const initial = (emp.full_name || "?").trim().charAt(0).toUpperCase();
  return (
    <span
      className={cn(
        sizeCls,
        textCls,
        "flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700 ring-2 ring-white shadow-md"
      )}
    >
      {initial || <UserRound className="size-7" />}
    </span>
  );
}

/* ================================================================
 *  Idle split — two huge tappable tiles, Kelish | Ketish
 * ================================================================ */

function IdleSplit({ onPick }: { onPick: (m: Mode) => void }) {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-2 md:gap-5 md:p-6">
      <IdleTile
        accent="emerald"
        title={t("main.tile_in_title")}
        subtitle={t("main.tile_in_subtitle")}
        Icon={LogIn}
        onClick={() => onPick("in")}
      />
      <IdleTile
        accent="amber"
        title={t("main.tile_out_title")}
        subtitle={t("main.tile_out_subtitle")}
        Icon={DoorOpen}
        onClick={() => onPick("out")}
      />
    </main>
  );
}

function IdleTile({
  accent,
  title,
  subtitle,
  Icon,
  onClick,
}: {
  accent: "emerald" | "amber";
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  const colors =
    accent === "emerald"
      ? "bg-gradient-to-br from-emerald-500 via-emerald-600 to-emerald-700 ring-emerald-300"
      : "bg-gradient-to-br from-amber-500 via-amber-600 to-amber-700 ring-amber-300";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-full w-full flex-col items-center justify-center gap-6 overflow-hidden rounded-3xl text-white shadow-xl ring-2 transition-all duration-150 active:scale-[0.985]",
        colors
      )}
    >
      {/* Soft halo behind the icon */}
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.18),transparent_60%)] opacity-90" />

      <span className="relative flex size-40 items-center justify-center rounded-full bg-white/15 ring-8 ring-white/20 backdrop-blur-sm transition-transform duration-200 group-hover:scale-105 group-active:scale-95 sm:size-48 md:size-56">
        <Icon className="size-20 drop-shadow-lg sm:size-24 md:size-28" />
      </span>

      <div className="relative text-center">
        <p className="text-4xl font-extrabold tracking-tight drop-shadow-lg sm:text-5xl md:text-6xl">
          {title}
        </p>
        <p className="mt-2 text-base font-medium text-white/85 sm:text-lg">
          {subtitle}
        </p>
      </div>
    </button>
  );
}

/* ================================================================
 *  Scan view — camera + cancel + manual fallback
 * ================================================================ */

function ScanView({
  mode,
  cameraRef,
  scanning,
  lastMatchName,
  onCancel,
  onManual,
}: {
  mode: Exclude<Mode, "idle">;
  cameraRef: React.MutableRefObject<CameraHandle | null>;
  scanning: boolean;
  lastMatchName: string | null;
  onCancel: () => void;
  onManual: () => void;
}) {
  const { t } = useTranslation();
  const isIn = mode === "in";
  const accentBg = isIn
    ? "from-emerald-50 via-white to-white"
    : "from-amber-50 via-white to-white";
  return (
    <main
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center bg-gradient-to-b p-5 sm:p-8",
        accentBg
      )}
    >
      <div className="flex w-full max-w-3xl flex-col items-center gap-5">
        {/* Top row — cancel + mode badge */}
        <div className="flex w-full items-center justify-between">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-medium text-ink-600 shadow-sm ring-1 ring-[var(--card-border)] transition hover:text-ink-900"
          >
            <ArrowLeft className="size-4" />
            {t("scan.cancel")}
          </button>
          <span className={isIn ? "pill-in" : "pill-out"}>
            {isIn ? t("main.tile_in_title") : t("main.tile_out_title")}
          </span>
        </div>

        {/* Camera */}
        <div className="w-full">
          <CameraPreview ref={cameraRef} scanning={scanning} />
        </div>

        {/* Instruction */}
        <div className="text-center">
          <p className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
            {scanning
              ? t("main.scanning_title")
              : lastMatchName
                ? t("main.cooldown_title", { name: lastMatchName })
                : t("main.idle_title")}
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-snug text-ink-500 sm:text-base">
            {lastMatchName ? t("main.cooldown_hint") : t("main.idle_hint")}
          </p>
        </div>

        {/* Manual fallback */}
        <button
          type="button"
          onClick={onManual}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-white px-4 py-2 text-sm font-medium text-ink-600 shadow-sm transition hover:border-brand-300 hover:text-brand-700"
        >
          <Keyboard className="size-4" />
          {t("main.manual_button")}
        </button>
      </div>
    </main>
  );
}
