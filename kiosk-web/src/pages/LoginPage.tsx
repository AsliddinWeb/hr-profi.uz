import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Link as LinkIcon, Loader2, ShieldCheck } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import type { KioskLoginResponse } from "@/lib/types";
import { LangSwitcher } from "@/components/LangSwitcher";
import { cn } from "@/lib/cn";

/* Login page for the tablet kiosk.
 *
 * Design notes:
 *   - Big, finger-friendly inputs (3rem min height) — operators key
 *     this in once per tablet, often standing.
 *   - Slug surfaced as a chip when present in the URL so operator can
 *     tell which kiosk identity they're about to attach the tablet to.
 *   - Branded gradient background with subtle face-detection-bracket
 *     watermark. Looks intentional, doesn't compete with the form.
 *   - Show/hide toggle on the password — typing on a glass keyboard is
 *     error-prone enough already.
 */

export function LoginPage({ slugFromUrl }: { slugFromUrl: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [slug, setSlug] = useState(slugFromUrl ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!slug.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.post<KioskLoginResponse>("/kiosks/auth/login", {
        slug: slug.trim().toLowerCase(),
        password,
      });
      setSession(r.data.access_token, r.data.kiosk);
      navigate(`/${r.data.kiosk.slug}`, { replace: true });
    } catch (e) {
      setError(apiErrorMessage(e, t("login.wrong_credentials")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Branded backdrop. The brackets are the same motif as the
          favicon, scaled up and de-emphasised to feel like a watermark. */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#2f70ff] via-[#1f5be6] to-[#193e94]" />
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at top right, white 0%, transparent 55%)",
        }}
      />
      <BackgroundBrackets />

      {/* Top bar (lang switcher) */}
      <div className="absolute right-5 top-5 z-10">
        <LangSwitcher dark />
      </div>

      {/* Center stack */}
      <div className="relative z-10 flex h-full items-center justify-center px-6 py-10">
        <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-2">
          {/* Left side — branding / value prop. Hidden on small screens
              to keep the form front and centre on phones / portrait tablets. */}
          <div className="hidden text-white lg:block">
            <BrandMark />
            <h1 className="mt-7 text-4xl font-extrabold tracking-tight">
              {t("login.title")}
            </h1>
            <p className="mt-3 max-w-md text-lg leading-snug text-white/80">
              {t("login.subtitle")}
            </p>

            <ul className="mt-8 space-y-3">
              <BulletItem>
                <ShieldCheck className="size-5" />
                {t("login.bullet_secure")}
              </BulletItem>
              <BulletItem>
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                  AI
                </span>
                {t("login.bullet_face")}
              </BulletItem>
              <BulletItem>
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                  ↻
                </span>
                {t("login.bullet_offline")}
              </BulletItem>
            </ul>
          </div>

          {/* Form card */}
          <form
            onSubmit={submit}
            className="w-full max-w-md justify-self-center rounded-3xl bg-white p-7 shadow-2xl ring-1 ring-black/5 lg:justify-self-end"
          >
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <BrandMark dark />
              <p className="text-base font-bold text-ink-900">
                {t("app.name")}
              </p>
            </div>

            <div className="hidden lg:block">
              <h2 className="text-2xl font-bold text-ink-900">
                {t("login.form_title")}
              </h2>
              <p className="mt-1 text-sm text-ink-500">{t("login.form_hint")}</p>
            </div>

            {/* Slug chip if URL pre-filled */}
            {slugFromUrl && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50/70 px-3 py-2 text-xs">
                <LinkIcon className="size-3.5 text-brand-600" />
                <span className="text-ink-500">{t("login.url_chip_label")}</span>
                <code className="font-mono font-semibold text-brand-800">
                  {slugFromUrl}
                </code>
              </div>
            )}

            <div className="mt-5 space-y-3.5">
              <Field label={t("login.slug_label")}>
                <input
                  className="input-lg"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder={t("login.slug_placeholder") ?? ""}
                  required
                />
              </Field>

              <Field label={t("login.password_label")}>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="input-lg pr-12"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus={Boolean(slugFromUrl)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-0 flex items-center pr-4 text-ink-400 hover:text-ink-700"
                    tabIndex={-1}
                    aria-label={
                      showPassword
                        ? t("login.hide_password") ?? "Hide"
                        : t("login.show_password") ?? "Show"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="size-5" />
                    ) : (
                      <Eye className="size-5" />
                    )}
                  </button>
                </div>
              </Field>

              {error && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className={cn(
                  "btn-primary w-full text-lg",
                  submitting && "pointer-events-none"
                )}
                disabled={submitting || !slug.trim() || !password}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-5 animate-spin" />
                    {t("login.submitting")}
                  </>
                ) : (
                  t("login.submit")
                )}
              </button>
            </div>

            {!slugFromUrl && (
              <div className="mt-5 rounded-xl border border-amber-100 bg-amber-50/80 px-3.5 py-3 text-[11px] leading-relaxed text-amber-900">
                <p className="font-semibold">{t("login.url_hint_title")}</p>
                <p className="mt-0.5">{t("login.url_hint_body")}</p>
              </div>
            )}

            <p className="mt-6 text-center text-[11px] text-ink-400">
              © {new Date().getFullYear()} Hr-Profi
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function BrandMark({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-2xl shadow-md",
          dark ? "bg-brand-600 text-white" : "bg-white/15 text-white ring-1 ring-white/30"
        )}
      >
        <svg viewBox="0 0 32 32" className="size-7" fill="none">
          <path
            d="M9 12V9h3M23 12V9h-3M9 20v3h3M23 20v3h-3"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="14.5" r="3" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path
            d="M11.5 22c1-2.5 3-3.5 4.5-3.5s3.5 1 4.5 3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {!dark && (
        <div>
          <p className="text-xl font-bold text-white">Hr-Profi</p>
          <p className="text-xs uppercase tracking-widest text-white/60">Kiosk</p>
        </div>
      )}
    </div>
  );
}

function BulletItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-sm text-white/85">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20">
        {Array.isArray(children) ? children[0] : null}
      </span>
      <span>{Array.isArray(children) ? children.slice(1) : children}</span>
    </li>
  );
}

/* Subtle face-bracket motif scattered across the backdrop. Pure decoration. */
function BackgroundBrackets() {
  return (
    <svg
      className="absolute inset-0 h-full w-full opacity-[0.07]"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      {[
        { x: 120, y: 120, s: 1 },
        { x: 980, y: 90, s: 0.8 },
        { x: 220, y: 600, s: 1.2 },
        { x: 850, y: 580, s: 0.9 },
        { x: 580, y: 360, s: 1.4 },
      ].map((p, i) => (
        <g
          key={i}
          transform={`translate(${p.x} ${p.y}) scale(${p.s})`}
          stroke="white"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M0 28V0h28" />
          <path d="M120 28V0h-28" />
          <path d="M0 92v28h28" />
          <path d="M120 92v28h-28" />
        </g>
      ))}
    </svg>
  );
}
