import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Clock, LogOut, Search, UserRound } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CameraPreview, type CameraHandle } from "@/components/CameraPreview";
import { LangSwitcher } from "@/components/LangSwitcher";
import { useAuthStore } from "@/stores/auth";
import type {
  KioskAttendanceResponse,
  KioskEmployee,
  KioskEmployeeList,
  KioskMeResponse,
  KioskRecognizeResponse,
} from "@/lib/types";

// How often the auto-recognize loop snaps a frame. 2.5 s is a sweet
// spot — fast enough that walking up to the tablet feels reactive,
// slow enough that a single API worker on a $5 VPS keeps up with face
// matching (~80–150 ms per call). Lower it on burlier hardware.
const RECOGNIZE_INTERVAL_MS = 2500;
// After firing a check on someone, ignore their face for this long
// so they don't get checked-in again as they linger to read the
// confirmation overlay.
const PER_EMPLOYEE_COOLDOWN_MS = 30_000;

type Direction = "IN" | "OUT";

interface ConfirmState {
  employee: KioskEmployee;
  direction: Direction;
}

export function MainPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const setKiosk = useAuthStore((s) => s.setKiosk);
  const logout = useAuthStore((s) => s.logout);

  const meQ = useQuery({
    queryKey: ["kiosk-me"],
    queryFn: async () => (await api.get<KioskMeResponse>("/kiosks/me")).data,
    refetchInterval: 60_000, // doubles as a heartbeat
  });

  // Mirror the kiosk row back into the auth store so the persisted
  // session always reflects the latest server state (e.g. renamed kiosk).
  useEffect(() => {
    if (meQ.data?.kiosk) setKiosk(meQ.data.kiosk);
  }, [meQ.data?.kiosk, setKiosk]);

  const [search, setSearch] = useState("");

  const employeesQ = useQuery({
    queryKey: ["kiosk-employees"],
    queryFn: async () =>
      (await api.get<KioskEmployeeList>("/kiosks/me/employees", { params: { limit: 500 } })).data,
    refetchInterval: 30_000,
  });

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

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [result, setResult] = useState<{
    response: KioskAttendanceResponse;
    direction: Direction;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Single camera at the top of the page — same physical camera the
  // tablet has. Frame is captured exactly once on confirm and attached
  // to the check-in/out as a selfie. Keeping the preview always-on
  // (rather than spinning up the camera per click) avoids the per-click
  // ~700ms warm-up that getUserMedia takes on tablet hardware.
  const cameraRef = useRef<CameraHandle | null>(null);

  const checkMut = useMutation({
    mutationFn: async (payload: { employee_id: string; direction: Direction }) => {
      const path = payload.direction === "IN" ? "/kiosks/me/checkin" : "/kiosks/me/checkout";
      const image_base64 = cameraRef.current?.captureFrame() ?? null;
      const r = await api.post<KioskAttendanceResponse>(path, {
        employee_id: payload.employee_id,
        image_base64,
      });
      return { response: r.data, direction: payload.direction };
    },
    onSuccess: (r) => {
      setConfirm(null);
      setResult(r);
      qc.invalidateQueries({ queryKey: ["kiosk-employees"] });
    },
    onError: (e) => {
      setErrorMsg(apiErrorMessage(e, t("errors.generic")));
    },
  });

  // Auto-dismiss the success overlay after 6s so the kiosk returns to
  // the directory ready for the next person.
  useEffect(() => {
    if (!result) return;
    const id = window.setTimeout(() => setResult(null), 6000);
    return () => window.clearTimeout(id);
  }, [result]);

  // Auto-clear error toast.
  useEffect(() => {
    if (!errorMsg) return;
    const id = window.setTimeout(() => setErrorMsg(null), 4000);
    return () => window.clearTimeout(id);
  }, [errorMsg]);

  /* ---------- Auto face-recognize loop ---------------------------- */
  // Per-employee cooldown so the same person standing in front of the
  // tablet doesn't get a fresh check-in every 2.5 s.
  const cooldownRef = useRef<Map<string, number>>(new Map());
  // ``true`` while the loop is mid-call so the interval never overlaps
  // a previous in-flight recognize on slow networks.
  const recognizingRef = useRef(false);

  useEffect(() => {
    // Pause the loop while a confirm modal or success overlay is on
    // screen — the operator's hands are busy, the tablet just had a
    // successful match, and the camera is probably mid-occluded.
    if (confirm || result) return;
    // Need camera + at least one fetched employee row before there's
    // anything to compare against.
    if (!employeesQ.data?.items?.length) return;

    let cancelled = false;

    async function tick() {
      if (cancelled || recognizingRef.current) return;
      const frame = cameraRef.current?.captureFrame();
      if (!frame) return;
      recognizingRef.current = true;
      try {
        const r = await api.post<KioskRecognizeResponse>(
          "/kiosks/me/recognize",
          { image_base64: frame }
        );
        if (cancelled || !r.data.matched || !r.data.match) return;
        const emp = r.data.match.employee;
        // Apply cooldown.
        const last = cooldownRef.current.get(emp.id) ?? 0;
        if (Date.now() - last < PER_EMPLOYEE_COOLDOWN_MS) return;
        cooldownRef.current.set(emp.id, Date.now());
        // Decide direction from current state. If a checked-in
        // employee's face is matched again, that's a check-out;
        // otherwise check-in.
        const direction: Direction = emp.is_currently_in ? "OUT" : "IN";
        // Fire directly — no confirm modal in auto mode. The success
        // overlay still gives a clear visible/audible confirmation.
        checkMut.mutate({ employee_id: emp.id, direction });
      } catch {
        // Recognize failures are normal (no face in frame) — stay
        // quiet. The loop will retry on the next tick.
      } finally {
        recognizingRef.current = false;
      }
    }

    const id = window.setInterval(tick, RECOGNIZE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [confirm, result, employeesQ.data, checkMut]);

  function pickEmployee(emp: KioskEmployee, direction: Direction) {
    // Friendly cross-checks: don't even bother sending if the row already
    // says the employee's state contradicts the requested action.
    if (direction === "IN" && emp.is_currently_in) {
      setErrorMsg(t("confirm.already_in"));
      return;
    }
    if (direction === "OUT" && !emp.is_currently_in) {
      setErrorMsg(t("confirm.already_out"));
      return;
    }
    setConfirm({ employee: emp, direction });
  }

  function handleLogout() {
    if (window.confirm(t("main.logout_confirm"))) {
      logout();
    }
  }

  const me = meQ.data;

  return (
    <div className="flex h-full w-full flex-col bg-[var(--page-bg)]">
      <Header
        branchName={me?.branch.name ?? "..."}
        kioskName={me?.kiosk.name ?? "..."}
        companyName={me?.company.name ?? ""}
        companyLogo={me?.company.logo_url ?? null}
        onLogout={handleLogout}
      />

      {/* Camera + search row */}
      <div className="border-b border-[var(--card-border)] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 md:flex-row md:items-center">
          <div className="shrink-0 md:w-72">
            <CameraPreview ref={cameraRef} />
            <p className="mt-2 text-center text-[11px] font-medium uppercase tracking-wider text-ink-500">
              {t("camera.title")}
            </p>
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute inset-y-0 left-4 my-auto size-5 text-ink-400" />
            <input
              type="search"
              className="w-full rounded-xl border-0 bg-ink-50 py-3.5 pl-12 pr-4 text-base ring-1 ring-inset ring-[var(--card-border)] transition placeholder:text-ink-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder={t("main.search_placeholder") ?? ""}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Split panes */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-2 md:p-5">
        <Pane
          direction="IN"
          title={t("main.checkin_title")}
          hint={t("main.checkin_hint")}
          employees={filtered}
          onPick={(e) => pickEmployee(e, "IN")}
          loading={employeesQ.isLoading}
          lang={i18n.language}
        />
        <Pane
          direction="OUT"
          title={t("main.checkout_title")}
          hint={t("main.checkout_hint")}
          employees={filtered}
          onPick={(e) => pickEmployee(e, "OUT")}
          loading={employeesQ.isLoading}
          lang={i18n.language}
        />
      </div>

      {/* Footer hint about Phase 4 */}
      <div className="border-t border-[var(--card-border)] bg-white px-6 py-2.5 text-center text-xs text-ink-500">
        {t("main.phase4_hint")}
      </div>

      {/* Confirm modal */}
      {confirm && (
        <ConfirmModal
          state={confirm}
          submitting={checkMut.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            checkMut.mutate({
              employee_id: confirm.employee.id,
              direction: confirm.direction,
            })
          }
        />
      )}

      {/* Success overlay */}
      {result && <ResultOverlay result={result} onClose={() => setResult(null)} />}

      {/* Error toast */}
      {errorMsg && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-xl bg-rose-600 px-5 py-3 text-base font-medium text-white shadow-lg">
          {errorMsg}
        </div>
      )}
    </div>
  );
}

function Header({
  branchName,
  kioskName,
  companyName,
  companyLogo,
  onLogout,
}: {
  branchName: string;
  kioskName: string;
  companyName: string;
  companyLogo: string | null;
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
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

function Pane({
  direction,
  title,
  hint,
  employees,
  onPick,
  loading,
  lang: _lang,
}: {
  direction: Direction;
  title: string;
  hint: string;
  employees: KioskEmployee[];
  onPick: (e: KioskEmployee) => void;
  loading: boolean;
  lang: string;
}) {
  const { t } = useTranslation();
  const isIn = direction === "IN";

  // For each pane only suggest the actionable rows on top, but still show
  // the rest below greyed-out — operators sometimes want to verify a
  // teammate's status visually.
  const sorted = useMemo(() => {
    const isActionable = (e: KioskEmployee) =>
      isIn ? !e.is_currently_in : e.is_currently_in;
    return [...employees].sort((a, b) => {
      const aa = isActionable(a) ? 0 : 1;
      const bb = isActionable(b) ? 0 : 1;
      if (aa !== bb) return aa - bb;
      return a.full_name.localeCompare(b.full_name);
    });
  }, [employees, isIn]);

  const actionableCount = sorted.filter((e) =>
    isIn ? !e.is_currently_in : e.is_currently_in
  ).length;

  return (
    <section className={cn("pane", isIn ? "pane-checkin" : "pane-checkout")}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className={cn(isIn ? "pill-in" : "pill-out")}>
              {isIn ? "IN" : "OUT"}
            </span>
            <span className="text-xs font-medium text-ink-500">
              {actionableCount} {t("main.available_short")}
            </span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-ink-900">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">{hint}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin">
        {loading ? (
          <p className="py-8 text-center text-ink-400">{t("main.loading")}</p>
        ) : sorted.length === 0 ? (
          <p className="py-8 text-center text-ink-400">{t("main.no_employees")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
            {sorted.map((e) => {
              const actionable = isIn ? !e.is_currently_in : e.is_currently_in;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onPick(e)}
                    className={cn("emp-card", !actionable && "emp-card-disabled")}
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
                      {e.is_currently_in ? t("main.currently_in") : t("main.currently_out")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

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

function ConfirmModal({
  state,
  submitting,
  onCancel,
  onConfirm,
}: {
  state: ConfirmState;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const isIn = state.direction === "IN";
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
            <Avatar emp={state.employee} large />
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-ink-900">
                {state.employee.full_name}
              </p>
              <p className="truncate text-sm text-ink-500">
                {state.employee.position ?? state.employee.department_name ?? ""}
              </p>
              {state.employee.employee_code && (
                <p className="mt-0.5 truncate font-mono text-[11px] text-ink-400">
                  {state.employee.employee_code}
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

function ResultOverlay({
  result,
  onClose,
}: {
  result: { response: KioskAttendanceResponse; direction: Direction };
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
          <p className="mt-0.5 font-mono text-lg tabular-nums text-white/80">
            {new Date(r.timestamp).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {r.is_late && (
          <span className="rounded-full bg-rose-700/90 px-4 py-2 text-sm font-semibold text-white shadow ring-1 ring-white/20">
            ⏰ {t("result.late", { minutes: r.late_minutes })}
          </span>
        )}
        {r.overtime_minutes > 0 && (
          <span className="rounded-full bg-indigo-700/90 px-4 py-2 text-sm font-semibold text-white shadow ring-1 ring-white/20">
            ⏱ {t("result.overtime", { minutes: r.overtime_minutes })}
          </span>
        )}
      </div>
      <p className="mt-10 text-sm font-medium text-white/70">
        {t("result.tap_anywhere")}
      </p>
    </div>
  );
}
