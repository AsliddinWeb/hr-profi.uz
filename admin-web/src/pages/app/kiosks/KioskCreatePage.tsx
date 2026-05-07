import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Copy, KeyRound, Link as LinkIcon, Tablet } from "lucide-react";
import { toast } from "sonner";

import { api, apiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import type { Branch, KioskCreateResponse, Page } from "@/lib/types";

/* Standalone "Add kiosk" page. Replaces the older modal flow — the
 * form has enough fields + needs visible help/examples that a half
 * dialog made it cramped on smaller screens. The created credentials
 * still get rendered inline (URL + slug + password) once the POST
 * returns; operator copies them, then we navigate back to the list. */

export function KioskCreatePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();

  const branchesQ = useQuery({
    queryKey: ["branches", "for-kiosks"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });
  const branches = branchesQ.data?.items ?? [];

  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] =
    useState<KioskCreateResponse | null>(null);

  // Auto-pick the first branch as soon as the list lands so the
  // operator doesn't have to make a meaningless choice when they only
  // have one branch.
  useEffect(() => {
    if (!branchId && branches.length > 0) {
      setBranchId(branches[0].id);
    }
  }, [branchId, branches]);

  const createMut = useMutation({
    mutationFn: async () => {
      const r = await api.post<KioskCreateResponse>("/kiosks", {
        name: name.trim(),
        branch_id: branchId,
        password,
        notes: notes.trim() || undefined,
      });
      return r.data;
    },
    onSuccess: (data) => {
      setCredentials(data);
      qc.invalidateQueries({ queryKey: ["kiosks"] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const examples = useMemo(
    () =>
      [
        t("kiosks.name_example_1"),
        t("kiosks.name_example_2"),
        t("kiosks.name_example_3"),
      ].filter(Boolean),
    [t]
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t("kiosks.error_name_required"));
      return;
    }
    if (!branchId) {
      setError(t("kiosks.error_branch_required"));
      return;
    }
    if (password.length < 4) {
      setError(t("kiosks.error_password_short"));
      return;
    }
    createMut.mutate();
  }

  // Empty branch list — the operator must create at least one branch
  // before adding kiosks (a kiosk is *for* a branch). Surface this
  // clearly instead of showing a disabled select with no hint.
  const noBranches = !branchesQ.isLoading && branches.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("kiosks.create_title")}
        breadcrumbs={[
          { label: t("kiosks.title"), to: "/app/kiosks" },
          { label: t("kiosks.create_title") },
        ]}
        icon={<Tablet className="size-5" />}
        description={t("kiosks.create_subtitle")}
      />

      {credentials ? (
        <CredentialsCard
          credentials={credentials}
          onDone={() => nav("/app/kiosks")}
        />
      ) : (
        <Card className="p-6">
          <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr,360px]">
            <div className="space-y-4">
              <div>
                <Input
                  label={t("kiosks.field_name") + " *"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("kiosks.field_name_placeholder") ?? ""}
                  hint={t("kiosks.field_name_hint") ?? undefined}
                  autoFocus
                  required
                />
                {examples.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {examples.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => setName(ex)}
                        className="rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[11px] text-ink-600 hover:border-brand-400 hover:text-brand-700"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="label">
                  {t("kiosks.field_branch") + " *"}
                </label>
                {noBranches ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {t("kiosks.no_branches_warning")}{" "}
                    <a
                      href="/app/branches/new"
                      className="font-semibold underline"
                    >
                      {t("kiosks.no_branches_cta")}
                    </a>
                  </div>
                ) : (
                  <select
                    className="input"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    disabled={branchesQ.isLoading}
                    required
                  >
                    {branchesQ.isLoading && (
                      <option value="">{t("common.loading")}</option>
                    )}
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}
                <p className="mt-1 text-xs text-ink-500">
                  {t("kiosks.field_branch_hint")}
                </p>
              </div>

              <Input
                type="password"
                label={t("kiosks.field_password") + " *"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={4}
                hint={t("kiosks.field_password_hint") ?? undefined}
                required
              />

              <Input
                label={t("kiosks.field_notes")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                hint={t("kiosks.field_notes_hint") ?? undefined}
              />

              {error && (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => nav("/app/kiosks")}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  loading={createMut.isPending}
                  disabled={noBranches}
                >
                  {t("kiosks.create_submit")}
                </Button>
              </div>
            </div>

            {/* Right-side help panel — shown alongside on lg screens, stacks
                below on smaller ones. Helps a first-time operator know
                what they're filling in without RTFM. */}
            <aside className="space-y-3 rounded-2xl bg-ink-50 p-4 text-sm">
              <h3 className="text-base font-semibold text-ink-900">
                {t("kiosks.help_title")}
              </h3>
              <p className="text-xs leading-relaxed text-ink-600">
                {t("kiosks.help_intro")}
              </p>
              <ul className="space-y-2 text-xs text-ink-700">
                <li>
                  <strong>{t("kiosks.help_naming")}:</strong>{" "}
                  {t("kiosks.help_naming_body")}
                </li>
                <li>
                  <strong>{t("kiosks.help_password")}:</strong>{" "}
                  {t("kiosks.help_password_body")}
                </li>
                <li>
                  <strong>{t("kiosks.help_url")}:</strong>{" "}
                  {t("kiosks.help_url_body")}
                </li>
              </ul>
            </aside>
          </form>
        </Card>
      )}
    </div>
  );
}

function CredentialsCard({
  credentials,
  onDone,
}: {
  credentials: KioskCreateResponse;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const copy = (val: string) => {
    navigator.clipboard.writeText(val);
    toast.success(t("kiosks.copied"));
  };
  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          <Tablet className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-ink-900">
            {t("kiosks.credentials_title")}
          </h2>
          <Badge tone="success" className="mt-1">
            {credentials.kiosk.name}
          </Badge>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        ⚠️ {t("kiosks.credentials_warning")}
      </div>

      <div className="mt-4 space-y-3">
        <CredRow
          icon={<LinkIcon className="size-4" />}
          label={t("kiosks.cred_url")}
          value={credentials.login_url}
          onCopy={() => copy(credentials.login_url)}
        />
        <CredRow
          label={t("kiosks.cred_slug")}
          value={credentials.kiosk.slug}
          onCopy={() => copy(credentials.kiosk.slug)}
        />
        <CredRow
          icon={<KeyRound className="size-4" />}
          label={t("kiosks.cred_password")}
          value={credentials.password}
          onCopy={() => copy(credentials.password)}
          mono
        />
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          {t("common.done")}
        </Button>
      </div>
    </Card>
  );
}

function CredRow({
  icon,
  label,
  value,
  onCopy,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  onCopy: () => void;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="label flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </label>
      <div className="flex items-center gap-2">
        <code
          className={cn(
            "flex-1 select-all break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs",
            mono ? "font-mono" : "font-medium"
          )}
        >
          {value}
        </code>
        <Button type="button" variant="secondary" size="sm" onClick={onCopy}>
          <Copy className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
