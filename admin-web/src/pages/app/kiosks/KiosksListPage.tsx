import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Building2,
  Copy,
  KeyRound,
  Link as LinkIcon,
  Plus,
  Power,
  Tablet,
  X,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import type {
  Branch,
  Kiosk,
  KioskCreateResponse,
  Page,
} from "@/lib/types";

export function KiosksListPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Kiosk | null>(null);
  const [credentials, setCredentials] = useState<KioskCreateResponse | null>(null);

  const kiosksQ = useQuery({
    queryKey: ["kiosks"],
    queryFn: async () =>
      (await api.get<Page<Kiosk>>("/kiosks", { params: { size: 200 } })).data,
    refetchInterval: 60_000,
  });

  const branchesQ = useQuery({
    queryKey: ["branches", "for-kiosks"],
    queryFn: async () =>
      (await api.get<Page<Branch>>("/branches", { params: { size: 200 } })).data,
  });
  const branchById = useMemo(() => {
    const m: Record<string, Branch> = {};
    for (const b of branchesQ.data?.items ?? []) m[b.id] = b;
    return m;
  }, [branchesQ.data]);

  const items = kiosksQ.data?.items ?? [];

  const deleteMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/kiosks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kiosks"] });
      toast.success(t("kiosks.deleted"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("kiosks.title")}
        breadcrumbs={[{ label: t("kiosks.title") }]}
        icon={<Tablet className="size-5" />}
        description={t("kiosks.subtitle")}
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t("kiosks.add")}
          </Button>
        }
      />

      {items.length === 0 ? (
        <Card className="p-10">
          <div className="flex flex-col items-center gap-3 text-center">
            <Tablet className="size-10 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">
              {t("kiosks.empty_title")}
            </p>
            <p className="max-w-md text-xs text-slate-500">
              {t("kiosks.empty_hint")}
            </p>
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              {t("kiosks.add")}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((k) => {
            const branch = branchById[k.branch_id];
            const url = `https://kiosk.hr-profi.uz/${k.slug}`;
            const lastSeen = k.last_seen_at
              ? new Date(k.last_seen_at).toLocaleString(i18n.language, {
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : t("kiosks.never_seen");
            return (
              <Card key={k.id} className="p-5">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl",
                      k.is_active
                        ? "bg-brand-100 text-brand-700"
                        : "bg-slate-100 text-slate-400"
                    )}
                  >
                    <Tablet className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-900">
                        {k.name}
                      </h3>
                      <Badge tone={k.is_active ? "success" : "default"}>
                        {k.is_active
                          ? t("kiosks.status_active")
                          : t("kiosks.status_inactive")}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      <Building2 className="mr-1 inline size-3" />
                      {branch?.name ?? "—"}
                    </p>
                  </div>
                </div>

                <div className="mt-3 space-y-2 text-[11px]">
                  <div className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5">
                    <LinkIcon className="size-3 text-slate-400" />
                    <code className="flex-1 truncate font-mono text-slate-700">
                      {url}
                    </code>
                    <button
                      type="button"
                      className="rounded-md p-1 text-slate-500 hover:bg-slate-200"
                      onClick={() => {
                        navigator.clipboard.writeText(url);
                        toast.success(t("kiosks.copied"));
                      }}
                      title={t("kiosks.copy_link") ?? undefined}
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-slate-500">
                    <span>{t("kiosks.last_seen")}: </span>
                    <span className="font-medium text-slate-700">
                      {lastSeen}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setResetting(k)}
                  >
                    <KeyRound className="size-3.5" />
                    {t("kiosks.reset_password")}
                  </Button>
                  {k.is_active && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (window.confirm(t("kiosks.delete_confirm") ?? "")) {
                          deleteMut.mutate(k.id);
                        }
                      }}
                      loading={deleteMut.isPending}
                    >
                      <Power className="size-3.5" />
                      {t("kiosks.deactivate")}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {creating && (
        <CreateDialog
          branches={branchesQ.data?.items ?? []}
          onClose={() => setCreating(false)}
          onCreated={(res) => {
            setCreating(false);
            setCredentials(res);
            qc.invalidateQueries({ queryKey: ["kiosks"] });
          }}
        />
      )}

      {resetting && (
        <ResetDialog
          kiosk={resetting}
          onClose={() => setResetting(null)}
          onReset={(res) => {
            setResetting(null);
            setCredentials(res);
            qc.invalidateQueries({ queryKey: ["kiosks"] });
          }}
        />
      )}

      {credentials && (
        <CredentialsDialog
          credentials={credentials}
          onClose={() => setCredentials(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CreateDialog({
  branches,
  onClose,
  onCreated,
}: {
  branches: Branch[];
  onClose: () => void;
  onCreated: (r: KioskCreateResponse) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim() || !branchId || password.length < 4) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.post<KioskCreateResponse>("/kiosks", {
        name: name.trim(),
        branch_id: branchId,
        password,
        notes: notes.trim() || undefined,
      });
      onCreated(r.data);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={t("kiosks.create_title")} onClose={onClose}>
      <div className="space-y-3">
        <Input
          label={t("kiosks.field_name") + " *"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("kiosks.field_name_placeholder") ?? ""}
          required
        />
        <div>
          <label className="label">{t("kiosks.field_branch") + " *"}</label>
          <select
            className="input"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <Input
          type="password"
          label={t("kiosks.field_password") + " *"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={4}
          hint={t("kiosks.field_password_hint") ?? undefined}
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
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={submit} loading={submitting}>
            <Plus className="size-4" />
            {t("kiosks.create_submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ResetDialog({
  kiosk,
  onClose,
  onReset,
}: {
  kiosk: Kiosk;
  onClose: () => void;
  onReset: (r: KioskCreateResponse) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (password.length < 4) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.post<KioskCreateResponse>(
        `/kiosks/${kiosk.id}/reset-password`,
        { password }
      );
      onReset(r.data);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={t("kiosks.reset_title", { name: kiosk.name })} onClose={onClose}>
      <div className="space-y-3">
        <Input
          type="password"
          label={t("kiosks.field_new_password") + " *"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={4}
        />
        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={submit} loading={submitting}>
            <KeyRound className="size-4" />
            {t("kiosks.reset_submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: KioskCreateResponse;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const copy = (val: string, msg: string) => {
    navigator.clipboard.writeText(val);
    toast.success(msg);
  };
  return (
    <Modal title={t("kiosks.credentials_title")} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          ⚠️ {t("kiosks.credentials_warning")}
        </div>

        <CredRow
          label={t("kiosks.cred_url")}
          value={credentials.login_url}
          onCopy={() =>
            copy(credentials.login_url, t("kiosks.copied"))
          }
        />
        <CredRow
          label={t("kiosks.cred_slug")}
          value={credentials.kiosk.slug}
          onCopy={() => copy(credentials.kiosk.slug, t("kiosks.copied"))}
        />
        <CredRow
          label={t("kiosks.cred_password")}
          value={credentials.password}
          onCopy={() => copy(credentials.password, t("kiosks.copied"))}
          mono
        />

        <div className="flex justify-end pt-2">
          <Button type="button" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CredRow({
  label,
  value,
  onCopy,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
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

/* ------------------------------------------------------------------ */

function Modal({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-8 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        className={cn(
          "relative my-auto w-full overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200",
          wide ? "max-w-xl" : "max-w-md"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
