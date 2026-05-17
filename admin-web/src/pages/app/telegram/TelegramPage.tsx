import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Filter,
  Plus,
  Save,
  Send,
  Trash2,
  UserCircle2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { api, apiErrorMessage } from "@/lib/api";
import type {
  Employee,
  NotificationCategory,
  Page,
  TelegramEventDef,
  TelegramSettings,
  TelegramSubscriber,
} from "@/lib/types";
import { cn } from "@/lib/cn";

const SUBSCRIBABLE_CATEGORIES: NotificationCategory[] = [
  "ATTENDANCE",
  "SALARY",
  "KPI",
  "LEAVE",
  "DEVICE",
  "ANOMALY",
];

export function TelegramPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("telegram.title")}
        breadcrumbs={[{ label: t("telegram.title") }]}
        icon={<Bot className="size-5" />}
        description={t("telegram.subtitle")}
      />
      <BotSettingsCard />
      <EventFiltersCard />
      <SubscribersCard />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Event filters                                                               */
/* -------------------------------------------------------------------------- */

function EventFiltersCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ["telegram", "settings"],
    queryFn: async () =>
      (await api.get<TelegramSettings>("/telegram/settings")).data,
  });
  const eventsQ = useQuery({
    queryKey: ["telegram", "events"],
    queryFn: async () =>
      (await api.get<TelegramEventDef[]>("/telegram/events")).data,
  });

  const updateMut = useMutation({
    mutationFn: async (patch: Record<string, boolean>) =>
      (
        await api.put<TelegramSettings>("/telegram/settings", {
          event_filters: patch,
        })
      ).data,
    onSuccess: (data) => {
      qc.setQueryData(["telegram", "settings"], data);
      toast.success(t("telegram.events_saved"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const filters = settingsQ.data?.event_filters ?? {};
  const events = eventsQ.data ?? [];
  const disabled = !settingsQ.data?.is_active;

  return (
    <Card className="p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
          <Filter className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">
            {t("telegram.events_title")}
          </h2>
          <p className="text-xs text-slate-500">
            {t("telegram.events_hint")}
          </p>
        </div>
      </header>

      {disabled && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("telegram.events_disabled_hint")}
        </div>
      )}

      <ul className="divide-y divide-slate-200">
        {events.map((e) => {
          const on = !!filters[e.key];
          return (
            <li
              key={e.key}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">
                    {t(`telegram.event_label.${e.key}`)}
                  </span>
                  <Badge tone="default">{e.category}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t(`telegram.event_hint.${e.key}`)}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                disabled={disabled || updateMut.isPending}
                onClick={() =>
                  updateMut.mutate({ [e.key]: !on })
                }
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                  on ? "bg-brand-500" : "bg-slate-300",
                  (disabled || updateMut.isPending) && "opacity-60 cursor-not-allowed"
                )}
              >
                <span
                  className={cn(
                    "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
                    on ? "translate-x-5" : "translate-x-0.5"
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Bot settings                                                                */
/* -------------------------------------------------------------------------- */

function BotSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [testChatId, setTestChatId] = useState("");

  const settingsQ = useQuery({
    queryKey: ["telegram", "settings"],
    queryFn: async () =>
      (await api.get<TelegramSettings>("/telegram/settings")).data,
  });

  const saveMut = useMutation({
    mutationFn: async (bot_token: string | null) =>
      (
        await api.put<TelegramSettings>("/telegram/settings", {
          bot_token,
        })
      ).data,
    onSuccess: (data) => {
      qc.setQueryData(["telegram", "settings"], data);
      setToken("");
      toast.success(
        data.is_active
          ? t("telegram.saved_active")
          : t("telegram.saved_cleared")
      );
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const testMut = useMutation({
    mutationFn: async () =>
      api.post("/telegram/settings/test", {
        chat_id: testChatId.trim(),
        text: undefined,
      }),
    onSuccess: () => toast.success(t("telegram.test_sent")),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const s = settingsQ.data;

  return (
    <Card className="p-5">
      <header className="mb-4 flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            s?.is_active
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-400"
          )}
        >
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">
              {t("telegram.bot_title")}
            </h2>
            <Badge tone={s?.is_active ? "success" : "default"}>
              {s?.is_active
                ? t("telegram.status_active")
                : t("telegram.status_inactive")}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("telegram.bot_hint")}
          </p>
        </div>
      </header>

      {s?.is_active && (
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs md:grid-cols-3">
          <InfoCell
            label={t("telegram.field_bot_username")}
            value={s.bot_username ? `@${s.bot_username}` : "—"}
          />
          <InfoCell
            label={t("telegram.field_bot_name")}
            value={s.bot_first_name ?? "—"}
          />
          <InfoCell
            label={t("telegram.field_last_verified")}
            value={
              s.last_verified_at
                ? new Date(s.last_verified_at).toLocaleString()
                : "—"
            }
          />
          {s.bot_token_masked && (
            <InfoCell
              label={t("telegram.field_token")}
              value={s.bot_token_masked}
              mono
            />
          )}
        </div>
      )}

      <div className="space-y-3">
        <Input
          label={t("telegram.field_new_token")}
          placeholder="123456789:AAH..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          hint={t("telegram.field_new_token_hint")}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => saveMut.mutate(token.trim() || null)}
            loading={saveMut.isPending}
            disabled={!token.trim() && !s?.is_active}
          >
            <Save className="size-4" />
            {token.trim()
              ? t("telegram.save_validate")
              : t("telegram.save_clear")}
          </Button>
          {s?.is_active && (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                if (window.confirm(t("telegram.clear_confirm") ?? "")) {
                  saveMut.mutate(null);
                }
              }}
              loading={saveMut.isPending}
            >
              <X className="size-4" />
              {t("telegram.clear")}
            </Button>
          )}
        </div>
      </div>

      {s?.is_active && (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">
            {t("telegram.test_title")}
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            {t("telegram.test_hint")}
          </p>
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[12rem]">
              <Input
                placeholder={t("telegram.field_chat_id")}
                value={testChatId}
                onChange={(e) => setTestChatId(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => testMut.mutate()}
              loading={testMut.isPending}
              disabled={!testChatId.trim()}
            >
              <Send className="size-4" />
              {t("telegram.test_send")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function InfoCell({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={cn(
          "text-xs font-medium text-slate-800",
          mono && "font-mono"
        )}
      >
        {value}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Subscribers                                                                 */
/* -------------------------------------------------------------------------- */

function SubscribersCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const subsQ = useQuery({
    queryKey: ["telegram", "subscribers"],
    queryFn: async () =>
      (await api.get<TelegramSubscriber[]>("/telegram/subscribers")).data,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) =>
      api.delete(`/telegram/subscribers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["telegram", "subscribers"] });
      toast.success(t("telegram.subscriber_deleted"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Card className="p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {t("telegram.subs_title")}
          </h2>
          <p className="text-xs text-slate-500">
            {t("telegram.subs_hint")}
          </p>
        </div>
        <Button type="button" onClick={() => setShowCreate(true)}>
          <Plus className="size-4" />
          {t("telegram.subs_add")}
        </Button>
      </header>

      {(subsQ.data?.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          {t("telegram.subs_empty")}
        </div>
      ) : (
        <ul className="divide-y divide-slate-200">
          {subsQ.data?.map((sub) => (
            <SubscriberRow
              key={sub.id}
              sub={sub}
              onDelete={() => {
                if (window.confirm(t("telegram.subs_delete_confirm") ?? "")) {
                  deleteMut.mutate(sub.id);
                }
              }}
            />
          ))}
        </ul>
      )}

      {showCreate && (
        <CreateSubscriberDialog onClose={() => setShowCreate(false)} />
      )}
    </Card>
  );
}

function SubscriberRow({
  sub,
  onDelete,
}: {
  sub: TelegramSubscriber;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(sub);
  const [editing, setEditing] = useState(false);
  const [editingCats, setEditingCats] = useState(false);

  const updateMut = useMutation({
    mutationFn: async (patch: Partial<TelegramSubscriber>) =>
      (
        await api.patch<TelegramSubscriber>(
          `/telegram/subscribers/${sub.id}`,
          patch
        )
      ).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["telegram", "subscribers"] });
      setDraft(data);
      setEditing(false);
      setEditingCats(false);
      toast.success(t("telegram.subs_updated"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleCat = (c: NotificationCategory) => {
    const has = draft.enabled_categories.includes(c);
    const next = has
      ? draft.enabled_categories.filter((x) => x !== c)
      : [...draft.enabled_categories, c];
    setDraft({ ...draft, enabled_categories: next });
  };

  return (
    <li className="py-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <UserCircle2 className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">
              {sub.employee_full_name ?? sub.employee_id.slice(0, 8)}
            </span>
            {sub.label && (
              <span className="text-xs text-slate-500">
                · {sub.label}
              </span>
            )}
            <Badge tone={sub.is_active ? "success" : "default"}>
              {sub.is_active ? t("common.active") : t("common.inactive")}
            </Badge>
            {sub.last_error && (
              <Badge tone="danger">
                <AlertTriangle className="size-3" />
                {t("telegram.last_error_label")}
              </Badge>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>
              <span className="text-slate-400">chat_id:</span>{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">
                {sub.chat_id}
              </code>
            </span>
            {sub.last_sent_at && (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="size-3 text-emerald-600" />
                {t("telegram.last_sent")}:{" "}
                {new Date(sub.last_sent_at).toLocaleString()}
              </span>
            )}
            {sub.last_error && (
              <span className="text-rose-600">{sub.last_error}</span>
            )}
          </div>

          {editing && (
            <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
              <Input
                label={t("telegram.field_chat_id")}
                value={draft.chat_id}
                onChange={(e) =>
                  setDraft({ ...draft, chat_id: e.target.value })
                }
              />
              <Input
                label={t("telegram.field_label")}
                value={draft.label ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, label: e.target.value })
                }
              />
              <div className="md:col-span-2 flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setDraft(sub);
                    setEditing(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    updateMut.mutate({
                      chat_id: draft.chat_id,
                      label: draft.label,
                    })
                  }
                  loading={updateMut.isPending}
                >
                  {t("common.save")}
                </Button>
              </div>
            </div>
          )}

          <div className="mt-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
              {t("telegram.field_categories")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUBSCRIBABLE_CATEGORIES.map((c) => {
                const on = draft.enabled_categories.includes(c);
                return (
                  <button
                    type="button"
                    key={c}
                    onClick={() => {
                      setEditingCats(true);
                      toggleCat(c);
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] transition",
                      on
                        ? "border-brand-500 bg-brand-50 text-brand-800"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                    )}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            {editingCats && (
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDraft(sub);
                    setEditingCats(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    updateMut.mutate({
                      enabled_categories: draft.enabled_categories,
                    })
                  }
                  loading={updateMut.isPending}
                >
                  {t("telegram.save_categories")}
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              updateMut.mutate({ is_active: !sub.is_active });
            }}
            loading={updateMut.isPending}
          >
            {sub.is_active ? t("common.deactivate") : t("common.activate")}
          </Button>
          {!editing && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditing(true)}
            >
              {t("common.edit")}
            </Button>
          )}
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Create subscriber modal                                                    */
/* -------------------------------------------------------------------------- */

function CreateSubscriberDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const empQ = useQuery({
    queryKey: ["employees", "for-telegram"],
    queryFn: async () =>
      (
        await api.get<Page<Employee>>("/employees", {
          params: { size: 200, is_active: true },
        })
      ).data,
  });

  const [employeeId, setEmployeeId] = useState("");
  const [chatId, setChatId] = useState("");
  const [label, setLabel] = useState("");
  const [cats, setCats] = useState<NotificationCategory[]>([
    "ATTENDANCE",
    "ANOMALY",
  ]);

  const createMut = useMutation({
    mutationFn: async () =>
      (
        await api.post<TelegramSubscriber>("/telegram/subscribers", {
          employee_id: employeeId,
          chat_id: chatId.trim(),
          label: label.trim() || null,
          enabled_categories: cats,
          is_active: true,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["telegram", "subscribers"] });
      toast.success(t("telegram.subs_created"));
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const employees = useMemo(
    () =>
      (empQ.data?.items ?? []).slice().sort((a, b) =>
        (a.full_name ?? "").localeCompare(b.full_name ?? "")
      ),
    [empQ.data]
  );

  const canSubmit = employeeId && chatId.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-8 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        className="relative my-auto w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">
            {t("telegram.subs_add_title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="label">
              {t("telegram.field_employee")} *
            </label>
            <select
              className="input"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">— {t("telegram.choose_employee")} —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name} ({e.employee_code})
                </option>
              ))}
            </select>
          </div>
          <Input
            label={t("telegram.field_chat_id") + " *"}
            placeholder="123456789"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            hint={t("telegram.field_chat_id_hint")}
          />
          <Input
            label={t("telegram.field_label")}
            placeholder={t("telegram.field_label_placeholder") ?? undefined}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div>
            <label className="label">{t("telegram.field_categories")}</label>
            <div className="flex flex-wrap gap-1.5">
              {SUBSCRIBABLE_CATEGORIES.map((c) => {
                const on = cats.includes(c);
                return (
                  <button
                    type="button"
                    key={c}
                    onClick={() =>
                      setCats(
                        on ? cats.filter((x) => x !== c) : [...cats, c]
                      )
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition",
                      on
                        ? "border-brand-500 bg-brand-50 text-brand-800"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                    )}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => createMut.mutate()}
              loading={createMut.isPending}
              disabled={!canSubmit}
            >
              <Plus className="size-4" />
              {t("telegram.subs_add")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
