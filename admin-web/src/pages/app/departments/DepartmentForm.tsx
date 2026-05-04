import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import type { Branch, Department, Page } from "@/lib/types";

export interface DepartmentFormValue {
  branch_id: string;
  parent_id: string;
  name: string;
  code: string;
  description: string;
}

export const emptyDepartmentForm: DepartmentFormValue = {
  branch_id: "",
  parent_id: "",
  name: "",
  code: "",
  description: "",
};

export function departmentToForm(d: Department): DepartmentFormValue {
  return {
    branch_id: d.branch_id,
    parent_id: d.parent_id ?? "",
    name: d.name,
    code: d.code ?? "",
    description: d.description ?? "",
  };
}

export function departmentFormToCreate(f: DepartmentFormValue) {
  return {
    branch_id: f.branch_id,
    parent_id: f.parent_id || null,
    name: f.name.trim(),
    code: f.code.trim() || null,
    description: f.description.trim() || null,
  };
}

/** PATCH ignores branch_id (the backend doesn't accept it on update — moving a
 * department across branches would orphan its subtree). */
export function departmentFormToUpdate(f: DepartmentFormValue) {
  return {
    parent_id: f.parent_id || null,
    name: f.name.trim(),
    code: f.code.trim() || null,
    description: f.description.trim() || null,
  };
}

interface Props {
  value: DepartmentFormValue;
  onChange: (next: DepartmentFormValue) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
  errorMessage?: string | null;
  /** When set, the user is editing an existing dept — branch is locked and we
   * also exclude this id (and its descendants) from the parent picker. */
  editingId?: string;
}

export function DepartmentForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
  errorMessage,
  editingId,
}: Props) {
  const { t } = useTranslation();

  const branchesQ = useQuery({
    queryKey: ["branches", "for-dept-form"],
    queryFn: async () =>
      (
        await api.get<Page<Branch>>("/branches", {
          params: { size: 200, is_active: true },
        })
      ).data,
  });

  const deptsQ = useQuery({
    queryKey: ["departments", "for-dept-form"],
    queryFn: async () =>
      (await api.get<Page<Department>>("/departments", { params: { size: 200 } })).data,
  });

  const branches = branchesQ.data?.items ?? [];
  const allDepts = deptsQ.data?.items ?? [];

  // Compute the descendant set of `editingId` so the parent dropdown can't
  // pick a child (which would create a cycle).
  const forbiddenIds = useMemo(() => {
    if (!editingId) return new Set<string>();
    const childrenOf = new Map<string, string[]>();
    for (const d of allDepts) {
      if (d.parent_id) {
        const arr = childrenOf.get(d.parent_id) ?? [];
        arr.push(d.id);
        childrenOf.set(d.parent_id, arr);
      }
    }
    const out = new Set<string>([editingId]);
    const stack = [editingId];
    while (stack.length) {
      const id = stack.pop()!;
      for (const c of childrenOf.get(id) ?? []) {
        if (!out.has(c)) {
          out.add(c);
          stack.push(c);
        }
      }
    }
    return out;
  }, [allDepts, editingId]);

  const parentOptions = useMemo(() => {
    if (!value.branch_id) return [];
    return allDepts
      .filter(
        (d) =>
          d.branch_id === value.branch_id &&
          d.is_active &&
          !forbiddenIds.has(d.id)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allDepts, value.branch_id, forbiddenIds]);

  const set = <K extends keyof DepartmentFormValue>(k: K, v: DepartmentFormValue[K]) =>
    onChange({ ...value, [k]: v });

  // Switching branches: the previously-picked parent may live under a different
  // branch and would no longer be valid, so reset it.
  const onBranchChange = (id: string) => {
    onChange({ ...value, branch_id: id, parent_id: "" });
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {/* General */}
      <Card>
        <div className="space-y-5 p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              {t("departments_page.section_general")}
            </h2>
            <p className="text-xs text-slate-500">
              {t("departments_page.section_general_hint")}
            </p>
          </div>

          <div>
            <label className="label">{t("departments_page.branch")}</label>
            <select
              className="input"
              value={value.branch_id}
              onChange={(e) => onBranchChange(e.target.value)}
              required
              disabled={!!editingId}
            >
              <option value="">— {t("common.select")} —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {editingId ? (
              <p className="mt-1.5 text-xs text-slate-500">
                {t("departments_page.branch_locked_hint")}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">
                {t("departments_page.branch_hint")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t("departments_page.name")}
              value={value.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={t("departments_page.name_placeholder") ?? ""}
              required
              maxLength={200}
            />
            <Input
              label={t("departments_page.code")}
              value={value.code}
              onChange={(e) => set("code", e.target.value)}
              placeholder="DEV-01"
              maxLength={64}
              hint={t("departments_page.code_hint") ?? undefined}
            />
          </div>
        </div>
      </Card>

      {/* Hierarchy */}
      <Card>
        <div className="space-y-5 p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              {t("departments_page.section_hierarchy")}
            </h2>
            <p className="text-xs text-slate-500">
              {t("departments_page.section_hierarchy_hint")}
            </p>
          </div>

          <div>
            <label className="label">{t("departments_page.parent")}</label>
            <select
              className="input"
              value={value.parent_id}
              onChange={(e) => set("parent_id", e.target.value)}
              disabled={!value.branch_id}
            >
              <option value="">— {t("departments_page.no_parent")} —</option>
              {parentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code ? `${d.code} · ` : ""}
                  {d.name}
                </option>
              ))}
            </select>
            {!value.branch_id && (
              <p className="mt-1.5 text-xs text-slate-500">
                {t("departments_page.parent_disabled_hint")}
              </p>
            )}
            {value.branch_id && parentOptions.length === 0 && (
              <p className="mt-1.5 text-xs text-slate-500">
                {t("departments_page.parent_empty_hint")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Description */}
      <Card>
        <div className="space-y-3 p-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">
              {t("departments_page.section_description")}
            </h2>
            <p className="text-xs text-slate-500">
              {t("departments_page.section_description_hint")}
            </p>
          </div>
          <div>
            <label className="label">{t("departments_page.description")}</label>
            <textarea
              className="input min-h-[96px] resize-y py-2"
              value={value.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={t("departments_page.description_placeholder") ?? ""}
              maxLength={500}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              {value.description.length}/500
            </p>
          </div>
        </div>
      </Card>

      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
