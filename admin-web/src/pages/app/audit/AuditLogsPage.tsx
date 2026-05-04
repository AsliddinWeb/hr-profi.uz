import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  Network,
  RefreshCw,
  Scroll,
  Search,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import type {
  AuditLogActionStat,
  AuditLogEntry,
  Page,
} from "@/lib/types";

const PAGE_SIZE = 50;

/**
 * Tone an action string by its first segment.
 *
 * The audit table accumulates strings like ``leave.decision``, ``auth.login``,
 * ``user.create``, etc. We map the prefix to a colour so the user can scan
 * the timeline without reading every entry.
 */
function actionTone(action: string): Parameters<typeof Badge>[0]["tone"] {
  const head = action.split(".")[0];
  if (head === "auth") return "info";
  if (head === "leave" || head === "salary") return "success";
  if (head === "kpi") return "info";
  if (head === "device" || head === "anomaly") return "warning";
  if (action.endsWith(".delete") || action.endsWith(".reject")) return "danger";
  return "default";
}

function fmtDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AuditLogsPage() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce the free-text input so we don't hammer the API on every keystroke.
  useMemo(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const actionsQ = useQuery({
    queryKey: ["audit", "actions"],
    queryFn: async () =>
      (
        await api.get<AuditLogActionStat[]>("/audit-logs/actions", {
          params: { days: 30 },
        })
      ).data,
    staleTime: 5 * 60_000,
  });

  const logsQ = useQuery({
    queryKey: [
      "audit",
      "logs",
      page,
      actionFilter,
      resourceTypeFilter,
      debouncedQuery,
    ],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        page,
        size: PAGE_SIZE,
      };
      if (actionFilter) params.action = actionFilter;
      if (resourceTypeFilter) params.resource_type = resourceTypeFilter;
      if (debouncedQuery) params.q = debouncedQuery;
      return (await api.get<Page<AuditLogEntry>>("/audit-logs", { params })).data;
    },
    placeholderData: (prev) => prev,
  });

  const items = logsQ.data?.items ?? [];
  const total = logsQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const actions = actionsQ.data ?? [];

  // Group action chips by their resource prefix so the user can quickly skim
  // "auth.*", "leave.*", "kpi.*" — easier than a flat alphabetical list.
  const groupedActions = useMemo(() => {
    const m = new Map<string, AuditLogActionStat[]>();
    for (const a of actions) {
      const key = a.action.split(".")[0];
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [actions]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("audit.title")}
        breadcrumbs={[{ label: t("audit.title") }]}
        icon={<Scroll className="size-5" />}
        description={t("audit.subtitle")}
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void logsQ.refetch();
              void actionsQ.refetch();
            }}
            loading={logsQ.isFetching}
          >
            <RefreshCw className="size-4" />
            {t("audit.refresh")}
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="card space-y-3 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="label">{t("audit.search")}</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
              <Input
                className="pl-9"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={t("audit.search_placeholder")}
              />
            </div>
          </div>
          <div>
            <label className="label">{t("audit.resource_type")}</label>
            <Input
              value={resourceTypeFilter}
              onChange={(e) => {
                setResourceTypeFilter(e.target.value);
                setPage(1);
              }}
              placeholder={t("audit.resource_type_placeholder")}
            />
          </div>
        </div>

        {/* Action chips */}
        {groupedActions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActionFilter("");
                setPage(1);
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition",
                actionFilter === ""
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-ink-200 bg-white text-ink-700 hover:border-brand-300"
              )}
            >
              {t("audit.filter_all")}
            </button>
            {groupedActions.map(([group, rows]) => (
              <div key={group} className="flex items-center gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                  {group}
                </span>
                {rows.slice(0, 6).map((a) => {
                  const active = actionFilter === a.action;
                  return (
                    <button
                      key={a.action}
                      type="button"
                      onClick={() => {
                        setActionFilter(active ? "" : a.action);
                        setPage(1);
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono transition",
                        active
                          ? "border-brand-600 bg-brand-50 text-brand-700"
                          : "border-ink-200 bg-white text-ink-600 hover:border-brand-300"
                      )}
                    >
                      {a.action}
                      <span className="rounded-full bg-ink-100 px-1 text-[9px] font-semibold tabular-nums text-ink-600">
                        {a.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      {logsQ.isLoading ? (
        <p className="py-12 text-center text-sm text-ink-500">
          {t("common.loading")}
        </p>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-12 text-center">
          <Scroll className="size-8 text-ink-300" />
          <p className="text-sm font-medium text-ink-600">
            {t("audit.empty")}
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-[var(--card-border)]">
          {items.map((row) => (
            <AuditRow key={row.id} row={row} locale={i18n.language} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-500">
            {t("audit.page_info", {
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, total),
              total,
            })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
              {t("audit.prev")}
            </Button>
            <span className="font-mono text-xs tabular-nums text-ink-600">
              {page} / {pages}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
            >
              {t("audit.next")}
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditRow({ row, locale }: { row: AuditLogEntry; locale: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const tone = actionTone(row.action);
  const hasPayload = row.payload && Object.keys(row.payload).length > 0;

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge tone={tone}>{row.action}</Badge>
        {row.resource_type && (
          <span className="inline-flex items-center gap-1 rounded-full bg-ink-50 px-2 py-0.5 font-mono text-[11px] text-ink-700">
            <FileText className="size-3" />
            {row.resource_type}
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-500">
          {fmtDateTime(row.created_at, locale)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-600">
        <span className="inline-flex items-center gap-1">
          <UserIcon className="size-3" />
          {row.actor_username ? (
            <>
              <span className="font-semibold text-ink-800">
                {row.actor_full_name || row.actor_username}
              </span>
              <span className="text-ink-400">@{row.actor_username}</span>
            </>
          ) : (
            <span className="text-ink-400">{t("audit.actor_deleted")}</span>
          )}
        </span>
        {row.actor_role && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 text-[10px] font-bold uppercase text-brand-700">
            <ShieldCheck className="size-2.5" />
            {row.actor_role}
          </span>
        )}
        {row.ip_address && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-500">
            <Network className="size-3" />
            {row.ip_address}
          </span>
        )}
        {row.resource_id && (
          <span className="font-mono text-[10px] text-ink-400">
            id: {row.resource_id.slice(0, 8)}…
          </span>
        )}
      </div>
      {hasPayload && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline"
          >
            <Code2 className="size-3" />
            {expanded ? t("audit.hide_payload") : t("audit.show_payload")}
          </button>
          {expanded && (
            <pre className="mt-1.5 overflow-x-auto rounded-md bg-ink-50 p-2 font-mono text-[11px] text-ink-800">
              {JSON.stringify(row.payload, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
