import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Banknote,
  Briefcase,
  Calculator,
  CalendarClock,
  Clock,
  Coffee,
  ExternalLink,
  ImagePlus,
  KeyRound,
  Loader2,
  Lock,
  StickyNote,
  Sunset,
  Sunrise,
  Trash2,
  Upload,
  User as UserIcon,
} from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { useEnumLabel } from "@/lib/enum";
import { cn } from "@/lib/cn";
import type {
  Branch,
  Company,
  Department,
  Employee,
  Gender,
  Page,
  SalaryType,
  ShiftTemplate,
  WorkType,
} from "@/lib/types";

import { MonthlyScheduleEditor } from "./MonthlyScheduleEditor";

// ----------------------------------------------------------------------------
// Form value + (de)serialization helpers
// ----------------------------------------------------------------------------

export interface EmployeeFormValue {
  // identity
  employee_code: string;
  full_name: string;
  photo_url: string;
  gender: "" | Gender;
  position: string;
  // contact
  phone: string;
  email: string;
  address: string;
  // personal
  birth_date: string;
  passport: string;
  inn: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relation: string;
  // assignment
  branch_id: string;
  department_id: string;
  hire_date: string;
  work_type: WorkType;
  shift_template_id: string;
  // compensation
  salary_type: SalaryType;
  base_salary: string;
  hourly_rate: string;
  daily_rate: string;
  overtime_multiplier: string;
  bank_card_number: string;
  bank_name: string;
  // misc
  notes: string;
  // login (create only)
  create_login: boolean;
  login_username: string;
  login_password: string;
}

export const emptyEmployeeForm: EmployeeFormValue = {
  employee_code: "",
  full_name: "",
  photo_url: "",
  gender: "",
  position: "",
  phone: "",
  email: "",
  address: "",
  birth_date: "",
  passport: "",
  inn: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  emergency_contact_relation: "",
  branch_id: "",
  department_id: "",
  hire_date: "",
  work_type: "FIXED_SHIFT",
  shift_template_id: "",
  salary_type: "MONTHLY",
  base_salary: "",
  hourly_rate: "",
  daily_rate: "",
  overtime_multiplier: "1.5",
  bank_card_number: "",
  bank_name: "",
  notes: "",
  create_login: false,
  login_username: "",
  login_password: "",
};

export function employeeToForm(e: Employee): EmployeeFormValue {
  return {
    employee_code: e.employee_code,
    full_name: e.full_name,
    photo_url: e.photo_url ?? "",
    gender: e.gender ?? "",
    position: e.position ?? "",
    phone: e.phone ?? "",
    email: e.email ?? "",
    address: e.address ?? "",
    birth_date: e.birth_date ?? "",
    passport: e.passport ?? "",
    inn: e.inn ?? "",
    emergency_contact_name: e.emergency_contact_name ?? "",
    emergency_contact_phone: e.emergency_contact_phone ?? "",
    emergency_contact_relation: e.emergency_contact_relation ?? "",
    branch_id: e.branch_id ?? "",
    department_id: e.department_id ?? "",
    hire_date: e.hire_date ?? "",
    work_type: e.work_type,
    shift_template_id: e.shift_template_id ?? "",
    salary_type: e.salary_type,
    base_salary: e.base_salary ?? "",
    hourly_rate: e.hourly_rate ?? "",
    daily_rate: e.daily_rate ?? "",
    overtime_multiplier: e.overtime_multiplier ?? "1.5",
    bank_card_number: e.bank_card_number ?? "",
    bank_name: e.bank_name ?? "",
    notes: e.notes ?? "",
    create_login: false,
    login_username: "",
    login_password: "",
  };
}

/** Serialize for `POST /employees` (Create). Fields are optional or null where
 * the backend allows it. */
export function employeeFormToCreate(f: EmployeeFormValue) {
  const body: Record<string, unknown> = {
    employee_code: f.employee_code.trim(),
    full_name: f.full_name.trim(),
    salary_type: f.salary_type,
    work_type: f.work_type,
    overtime_multiplier: Number(f.overtime_multiplier) || 1.5,
  };
  if (f.photo_url) body.photo_url = f.photo_url;
  if (f.gender) body.gender = f.gender;
  if (f.position.trim()) body.position = f.position.trim();
  if (f.phone.trim()) body.phone = f.phone.trim();
  if (f.email.trim()) body.email = f.email.trim();
  if (f.address.trim()) body.address = f.address.trim();
  if (f.birth_date) body.birth_date = f.birth_date;
  if (f.hire_date) body.hire_date = f.hire_date;
  if (f.passport.trim()) body.passport = f.passport.trim();
  if (f.inn.trim()) body.inn = f.inn.trim();
  if (f.emergency_contact_name.trim()) body.emergency_contact_name = f.emergency_contact_name.trim();
  if (f.emergency_contact_phone.trim()) body.emergency_contact_phone = f.emergency_contact_phone.trim();
  if (f.emergency_contact_relation.trim()) body.emergency_contact_relation = f.emergency_contact_relation.trim();
  if (f.bank_card_number.trim()) body.bank_card_number = f.bank_card_number.trim();
  if (f.bank_name.trim()) body.bank_name = f.bank_name.trim();
  if (f.notes.trim()) body.notes = f.notes.trim();
  if (f.branch_id) body.branch_id = f.branch_id;
  if (f.department_id) body.department_id = f.department_id;
  if (f.shift_template_id) body.shift_template_id = f.shift_template_id;
  // Only include the rate that matches the salary_type so we don't pin stale
  // numbers.
  if (f.salary_type === "MONTHLY" && f.base_salary) body.base_salary = f.base_salary;
  if (f.salary_type === "HOURLY" && f.hourly_rate) body.hourly_rate = f.hourly_rate;
  if (f.salary_type === "DAILY" && f.daily_rate) body.daily_rate = f.daily_rate;
  if (f.create_login) {
    body.create_login = true;
    body.login_username = f.login_username;
    body.login_password = f.login_password;
  }
  return body;
}

/** PATCH body — backend EmployeeUpdate doesn't accept employee_code (immutable
 * once set), and we explicitly send `null` for cleared fields so the server can
 * clear them. */
export function employeeFormToUpdate(f: EmployeeFormValue) {
  return {
    branch_id: f.branch_id || null,
    department_id: f.department_id || null,
    full_name: f.full_name.trim(),
    photo_url: f.photo_url || null,
    phone: f.phone.trim() || null,
    email: f.email.trim() || null,
    position: f.position.trim() || null,
    address: f.address.trim() || null,
    birth_date: f.birth_date || null,
    hire_date: f.hire_date || null,
    gender: f.gender || null,
    passport: f.passport.trim() || null,
    inn: f.inn.trim() || null,
    emergency_contact_name: f.emergency_contact_name.trim() || null,
    emergency_contact_phone: f.emergency_contact_phone.trim() || null,
    emergency_contact_relation: f.emergency_contact_relation.trim() || null,
    bank_card_number: f.bank_card_number.trim() || null,
    bank_name: f.bank_name.trim() || null,
    notes: f.notes.trim() || null,
    work_type: f.work_type,
    shift_template_id: f.shift_template_id || null,
    salary_type: f.salary_type,
    base_salary: f.salary_type === "MONTHLY" ? f.base_salary || null : null,
    hourly_rate: f.salary_type === "HOURLY" ? f.hourly_rate || null : null,
    daily_rate: f.salary_type === "DAILY" ? f.daily_rate || null : null,
    overtime_multiplier: Number(f.overtime_multiplier) || 1.5,
  };
}

// ----------------------------------------------------------------------------
// Form
// ----------------------------------------------------------------------------

interface Props {
  value: EmployeeFormValue;
  onChange: (next: EmployeeFormValue) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
  errorMessage?: string | null;
  /** When set, the login section is hidden and `employee_code` is read-only. */
  editingId?: string;
}

export function EmployeeForm({
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
  const label = useEnumLabel();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const branchesQ = useQuery({
    queryKey: ["branches", "for-employee-form"],
    queryFn: async () =>
      (
        await api.get<Page<Branch>>("/branches", {
          params: { size: 200, is_active: true },
        })
      ).data,
  });

  const deptsQ = useQuery({
    queryKey: ["departments", "for-employee-form"],
    queryFn: async () =>
      (await api.get<Page<Department>>("/departments", { params: { size: 200 } })).data,
  });

  const templatesQ = useQuery({
    queryKey: ["shift-templates", "for-employee-form"],
    queryFn: async () =>
      (await api.get<Page<ShiftTemplate>>("/shifts/templates", { params: { size: 100 } })).data,
  });

  // Company settings give us the working-days array — the salary preview uses
  // its length (× 4.33 weeks/month, rounded) to derive ~22 / ~26 days/month
  // so we don't hard-code 22 like before.
  const companyQ = useQuery({
    queryKey: ["company", "me"],
    queryFn: async () => (await api.get<Company>("/companies/me")).data,
  });

  const branches = branchesQ.data?.items ?? [];
  const allDepts = deptsQ.data?.items ?? [];
  const templates = templatesQ.data?.items ?? [];

  const selectedTemplate = useMemo(
    () => templates.find((tp) => tp.id === value.shift_template_id) ?? null,
    [templates, value.shift_template_id]
  );

  /** Hours/day from the selected shift template's `expected_hours`. Falls back
   * to 8 if no template is picked or it has no value set. */
  const hoursPerDay = useMemo(() => {
    const raw = selectedTemplate?.expected_hours;
    if (!raw) return 8;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 8;
  }, [selectedTemplate]);

  /** Days/month derived from the company's `working_days` array length × 4.33
   * (≈ weeks/month). Length 5 → 22, length 6 → 26. Defaults to 22. */
  const daysPerMonth = useMemo(() => {
    const wd = (companyQ.data?.settings as { working_days?: unknown } | undefined)?.working_days;
    if (Array.isArray(wd) && wd.length > 0) {
      return Math.round(wd.length * 4.33);
    }
    return 22;
  }, [companyQ.data]);

  // Department options narrow to selected branch (as required by data model).
  const deptOptions = useMemo(
    () =>
      value.branch_id
        ? allDepts.filter((d) => d.branch_id === value.branch_id && d.is_active)
        : [],
    [allDepts, value.branch_id]
  );

  // If branch changes and the picked dept doesn't belong to the new branch,
  // clear it.
  useEffect(() => {
    if (
      value.department_id &&
      !allDepts.find(
        (d) => d.id === value.department_id && d.branch_id === value.branch_id
      )
    ) {
      onChange({ ...value, department_id: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.branch_id, allDepts]);

  useEffect(() => {
    if (!value.photo_url && fileInputRef.current) fileInputRef.current.value = "";
  }, [value.photo_url]);

  const set = <K extends keyof EmployeeFormValue>(k: K, v: EmployeeFormValue[K]) =>
    onChange({ ...value, [k]: v });

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post<{ url: string }>("/uploads/image?folder=employees", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      set("photo_url", r.data.url);
    } catch (err) {
      setUploadError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {/* Section 1: Identity */}
      <Card>
        <div className="space-y-5 p-6">
          <SectionHead
            icon={<UserIcon className="size-4" />}
            title={t("employees.section_identity")}
            hint={t("employees.section_identity_hint")}
          />

          <div className="flex flex-wrap items-start gap-5">
            {/* Photo */}
            <div className="flex flex-col items-start gap-2">
              <div className="relative flex size-32 items-center justify-center overflow-hidden rounded-full border border-dashed border-slate-300 bg-slate-50">
                {value.photo_url ? (
                  <img
                    src={value.photo_url}
                    alt=""
                    className="size-full object-cover"
                    onError={() => setUploadError(t("branches.photo_load_error"))}
                  />
                ) : (
                  <ImagePlus className="size-8 text-slate-300" />
                )}
                {uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                    <Loader2 className="size-5 animate-spin text-brand-600" />
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload className="size-3.5" />
                  {value.photo_url ? t("employees.photo_replace") : t("employees.photo_upload")}
                </Button>
                {value.photo_url && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => set("photo_url", "")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
              {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
            </div>

            {/* Identity fields */}
            <div className="grid min-w-[260px] flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t("employees.code")}
                value={value.employee_code}
                // Read-only — autogenerated on Create (E-001, E-002, …) and
                // immutable on Edit. The server is the source of truth for
                // sequence allocation.
                onChange={() => {}}
                readOnly
                disabled
                placeholder={editingId ? "—" : "E-001"}
                maxLength={64}
                className="cursor-not-allowed bg-slate-100 font-mono"
                hint={
                  editingId
                    ? (t("employees.code_locked") ?? undefined)
                    : (t("employees.code_autogen_hint") ?? undefined)
                }
              />
              <Input
                label={t("employees.full_name")}
                value={value.full_name}
                onChange={(e) => set("full_name", e.target.value)}
                required
                maxLength={200}
                placeholder={t("employees.full_name_placeholder") ?? ""}
              />
              <div>
                <label className="label">{t("employees.gender")}</label>
                <select
                  className="input"
                  value={value.gender}
                  onChange={(e) => set("gender", e.target.value as "" | Gender)}
                >
                  <option value="">— {t("common.select")} —</option>
                  <option value="MALE">{label("gender", "MALE")}</option>
                  <option value="FEMALE">{label("gender", "FEMALE")}</option>
                  <option value="OTHER">{label("gender", "OTHER")}</option>
                </select>
              </div>
              <Input
                label={t("employees.position")}
                value={value.position}
                onChange={(e) => set("position", e.target.value)}
                placeholder={t("employees.position_placeholder") ?? ""}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Section 2: Contact */}
      <Card>
        <div className="space-y-5 p-6">
          <SectionHead
            icon={<UserIcon className="size-4" />}
            title={t("employees.section_contact")}
            hint={t("employees.section_contact_hint")}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t("employees.phone")}
              value={value.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+998 90 123 45 67"
              maxLength={32}
              type="tel"
            />
            <Input
              label={t("employees.email")}
              value={value.email}
              onChange={(e) => set("email", e.target.value)}
              type="email"
              maxLength={255}
            />
          </div>
          <Input
            label={t("employees.address")}
            value={value.address}
            onChange={(e) => set("address", e.target.value)}
            maxLength={500}
            placeholder={t("employees.address_placeholder") ?? ""}
          />
        </div>
      </Card>

      {/* Section 3: Personal documents */}
      <Card>
        <div className="space-y-5 p-6">
          <SectionHead
            icon={<UserIcon className="size-4" />}
            title={t("employees.section_personal")}
            hint={t("employees.section_personal_hint")}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label={t("employees.birth_date")}
              type="date"
              value={value.birth_date}
              onChange={(e) => set("birth_date", e.target.value)}
            />
            <Input
              label={t("employees.passport")}
              value={value.passport}
              onChange={(e) => set("passport", e.target.value)}
              placeholder="AA1234567"
              maxLength={64}
            />
            <Input
              label={t("employees.inn")}
              value={value.inn}
              onChange={(e) => set("inn", e.target.value)}
              placeholder="123456789"
              maxLength={32}
            />
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("employees.emergency_contact")}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label={t("employees.emergency_name")}
                value={value.emergency_contact_name}
                onChange={(e) => set("emergency_contact_name", e.target.value)}
                maxLength={200}
              />
              <Input
                label={t("employees.emergency_phone")}
                value={value.emergency_contact_phone}
                onChange={(e) => set("emergency_contact_phone", e.target.value)}
                placeholder="+998 90 123 45 67"
                maxLength={32}
                type="tel"
              />
              <Input
                label={t("employees.emergency_relation")}
                value={value.emergency_contact_relation}
                onChange={(e) => set("emergency_contact_relation", e.target.value)}
                placeholder={t("employees.emergency_relation_placeholder") ?? ""}
                maxLength={64}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Section 4: Assignment */}
      <Card>
        <div className="space-y-5 p-6">
          <SectionHead
            icon={<Briefcase className="size-4" />}
            title={t("employees.section_assignment")}
            hint={t("employees.section_assignment_hint")}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">{t("employees.branch")}</label>
              <select
                className="input"
                value={value.branch_id}
                onChange={(e) => set("branch_id", e.target.value)}
              >
                <option value="">— {t("departments_page.no_parent")} —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t("employees.department")}</label>
              <select
                className="input"
                value={value.department_id}
                onChange={(e) => set("department_id", e.target.value)}
                disabled={!value.branch_id}
              >
                <option value="">
                  — {value.branch_id ? t("departments_page.no_parent") : t("employees.pick_branch_first")} —
                </option>
                {deptOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code ? `${d.code} · ` : ""}
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label={t("employees.hire_date")}
              type="date"
              value={value.hire_date}
              onChange={(e) => set("hire_date", e.target.value)}
            />
            <div>
              <label className="label">{t("employees.work_type")}</label>
              <select
                className="input"
                value={value.work_type}
                onChange={(e) => set("work_type", e.target.value as WorkType)}
              >
                <option value="FIXED_SHIFT">{label("work_type", "FIXED_SHIFT")}</option>
                <option value="FLEXIBLE">{label("work_type", "FLEXIBLE")}</option>
                <option value="HYBRID">{label("work_type", "HYBRID")}</option>
              </select>
            </div>
          </div>
        </div>
      </Card>

      {/* Section 5: Compensation (with green preview) */}
      <CompensationCard
        value={value}
        onChange={onChange}
        hoursPerDay={hoursPerDay}
        daysPerMonth={daysPerMonth}
        selectedTemplate={selectedTemplate}
      />

      {/* Section 6: Schedule */}
      <Card>
        <div className="space-y-5 p-6">
          <SectionHead
            icon={<CalendarClock className="size-4" />}
            title={t("employees.section_schedule")}
            hint={t("employees.section_schedule_hint")}
          />

          <div>
            <label className="label">{t("employees.default_shift_template")}</label>
            <div className="flex items-center gap-2">
              <select
                className="input flex-1"
                value={value.shift_template_id}
                onChange={(e) => set("shift_template_id", e.target.value)}
              >
                <option value="">— {t("employees.no_default_template")} —</option>
                {templates.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                    {tp.start_time && tp.end_time
                      ? ` · ${tp.start_time.slice(0, 5)}–${tp.end_time.slice(0, 5)}`
                      : ""}
                    {tp.expected_hours ? ` · ${tp.expected_hours}h` : ""}
                  </option>
                ))}
              </select>
              <Link
                to="/app/shifts"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 px-2.5 py-2 text-xs text-slate-600 hover:bg-slate-50"
                target="_blank"
              >
                <ExternalLink className="size-3.5" />
                {t("employees.manage_templates")}
              </Link>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {t("employees.default_shift_template_hint")}
            </p>
          </div>

          {/* Selected template summary — makes it obvious that check-in /
              check-out times come from the template, not from a separate
              employee field. */}
          {selectedTemplate ? (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
              <TemplateStat
                icon={<Sunrise className="size-3.5" />}
                label={t("employees.tpl_start")}
                value={selectedTemplate.start_time?.slice(0, 5) ?? "—"}
              />
              <TemplateStat
                icon={<Sunset className="size-3.5" />}
                label={t("employees.tpl_end")}
                value={selectedTemplate.end_time?.slice(0, 5) ?? "—"}
              />
              <TemplateStat
                icon={<Coffee className="size-3.5" />}
                label={t("employees.tpl_break")}
                value={`${selectedTemplate.break_minutes} ${t("employees.tpl_min")}`}
              />
              <TemplateStat
                icon={<Clock className="size-3.5" />}
                label={t("employees.tpl_hours")}
                value={
                  selectedTemplate.expected_hours
                    ? `${selectedTemplate.expected_hours} ${t("employees.tpl_hr")}`
                    : "—"
                }
                primary
              />
            </div>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("employees.tpl_pick_warning")}
            </div>
          )}

          {editingId ? (
            <MonthlyScheduleEditor
              employeeId={editingId}
              defaultTemplateId={value.shift_template_id || null}
              templates={templates}
            />
          ) : (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {t("employees.schedule_after_create")}
            </div>
          )}
        </div>
      </Card>

      {/* Section 7: Notes */}
      <Card>
        <div className="space-y-3 p-6">
          <SectionHead
            icon={<StickyNote className="size-4" />}
            title={t("employees.section_notes")}
            hint={t("employees.section_notes_hint")}
          />
          <textarea
            className="input min-h-[88px] resize-y py-2"
            value={value.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder={t("employees.notes_placeholder") ?? ""}
          />
        </div>
      </Card>

      {/* Section 8: Login (create only) */}
      {!editingId && (
        <Card>
          <div className="space-y-4 p-6">
            <SectionHead
              icon={<KeyRound className="size-4" />}
              title={t("employees.section_login")}
              hint={t("employees.section_login_hint")}
            />
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={value.create_login}
                onChange={(e) => set("create_login", e.target.checked)}
              />
              {t("employees.create_login")}
            </label>
            {value.create_login && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t("employees.login_username")}
                  value={value.login_username}
                  onChange={(e) => set("login_username", e.target.value)}
                  required={value.create_login}
                  autoCapitalize="none"
                  prefix={<UserIcon className="size-4" />}
                />
                <Input
                  label={t("employees.login_password")}
                  type="password"
                  minLength={8}
                  value={value.login_password}
                  onChange={(e) => set("login_password", e.target.value)}
                  required={value.create_login}
                  prefix={<Lock className="size-4" />}
                />
              </div>
            )}
          </div>
        </Card>
      )}

      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
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

function SectionHead({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-brand-50 text-brand-600">
        {icon}
      </span>
      <div>
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

function TemplateStat({
  icon,
  label,
  value,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md bg-white px-3 py-2 ring-1 ring-slate-200",
        primary && "ring-2 ring-brand-300"
      )}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums text-slate-800",
          primary && "text-brand-700"
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Compensation card with green live preview
// ----------------------------------------------------------------------------

interface DerivedRates {
  hourly: number;
  daily: number;
  monthly: number;
  /** Hourly rate paid for overtime, given the configured multiplier. */
  overtimeHourly: number;
  /** Whichever value the admin entered — used to highlight in the preview. */
  primary: "hourly" | "daily" | "monthly" | null;
}

function deriveRates(
  value: EmployeeFormValue,
  hoursPerDay: number,
  daysPerMonth: number
): DerivedRates {
  const otMultiplier = Number(value.overtime_multiplier) || 1.5;
  let hourly = 0;
  let daily = 0;
  let monthly = 0;
  let primary: DerivedRates["primary"] = null;

  if (value.salary_type === "MONTHLY" && value.base_salary) {
    monthly = Number(value.base_salary) || 0;
    daily = monthly / daysPerMonth;
    hourly = daily / hoursPerDay;
    primary = "monthly";
  } else if (value.salary_type === "DAILY" && value.daily_rate) {
    daily = Number(value.daily_rate) || 0;
    monthly = daily * daysPerMonth;
    hourly = daily / hoursPerDay;
    primary = "daily";
  } else if (value.salary_type === "HOURLY" && value.hourly_rate) {
    hourly = Number(value.hourly_rate) || 0;
    daily = hourly * hoursPerDay;
    monthly = daily * daysPerMonth;
    primary = "hourly";
  }

  return {
    hourly,
    daily,
    monthly,
    overtimeHourly: hourly * otMultiplier,
    primary,
  };
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ");
}

function CompensationCard({
  value,
  onChange,
  hoursPerDay,
  daysPerMonth,
  selectedTemplate,
}: {
  value: EmployeeFormValue;
  onChange: (next: EmployeeFormValue) => void;
  hoursPerDay: number;
  daysPerMonth: number;
  selectedTemplate: ShiftTemplate | null;
}) {
  const { t } = useTranslation();
  const label = useEnumLabel();
  const set = <K extends keyof EmployeeFormValue>(k: K, v: EmployeeFormValue[K]) =>
    onChange({ ...value, [k]: v });

  const rates = useMemo(
    () => deriveRates(value, hoursPerDay, daysPerMonth),
    [value, hoursPerDay, daysPerMonth]
  );
  const hasPreview = rates.primary !== null;

  return (
    <Card>
      <div className="space-y-5 p-6">
        <SectionHead
          icon={<Calculator className="size-4" />}
          title={t("employees.section_compensation")}
          hint={t("employees.section_compensation_hint")}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">{t("employees.salary_type")}</label>
            <select
              className="input"
              value={value.salary_type}
              onChange={(e) => set("salary_type", e.target.value as SalaryType)}
            >
              <option value="MONTHLY">{label("salary_type", "MONTHLY")}</option>
              <option value="DAILY">{label("salary_type", "DAILY")}</option>
              <option value="HOURLY">{label("salary_type", "HOURLY")}</option>
              <option value="KPI_BASED">{label("salary_type", "KPI_BASED")}</option>
            </select>
            <p className="mt-1.5 text-xs text-slate-500">
              {t("employees.salary_type_hint")}
            </p>
          </div>

          {value.salary_type === "MONTHLY" && (
            <Input
              label={t("employees.base_salary")}
              value={value.base_salary}
              onChange={(e) => set("base_salary", e.target.value)}
              type="number"
              min="0"
              step="1000"
              placeholder="15 000 000"
              suffix={<span className="text-xs">{t("employees.currency_per_month")}</span>}
            />
          )}
          {value.salary_type === "DAILY" && (
            <Input
              label={t("employees.daily_rate")}
              value={value.daily_rate}
              onChange={(e) => set("daily_rate", e.target.value)}
              type="number"
              min="0"
              step="1000"
              placeholder="500 000"
              suffix={<span className="text-xs">{t("employees.currency_per_day")}</span>}
            />
          )}
          {value.salary_type === "HOURLY" && (
            <Input
              label={t("employees.hourly_rate")}
              value={value.hourly_rate}
              onChange={(e) => set("hourly_rate", e.target.value)}
              type="number"
              min="0"
              step="100"
              placeholder="60 000"
              suffix={<span className="text-xs">{t("employees.currency_per_hour")}</span>}
            />
          )}
          {value.salary_type === "KPI_BASED" && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {t("employees.salary_kpi_hint")}
            </div>
          )}
        </div>

        {/* GREEN PREVIEW */}
        {hasPreview && value.salary_type !== "KPI_BASED" && (
          <div className="rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/60 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              <Calculator className="size-3.5" />
              {t("employees.salary_preview_title")}
            </div>
            <p className="mt-0.5 text-xs text-emerald-700/80">
              {t("employees.salary_preview_hint", {
                days: daysPerMonth,
                hours: hoursPerDay,
              })}{" "}
              {selectedTemplate ? (
                <span className="font-medium">
                  ({t("employees.salary_preview_source_template", {
                    name: selectedTemplate.name,
                  })})
                </span>
              ) : (
                <span className="font-medium">
                  ({t("employees.salary_preview_source_default")})
                </span>
              )}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <PreviewTile
                label={t("employees.preview_hourly")}
                value={fmtMoney(rates.hourly)}
                primary={rates.primary === "hourly"}
              />
              <PreviewTile
                label={t("employees.preview_daily")}
                value={fmtMoney(rates.daily)}
                primary={rates.primary === "daily"}
              />
              <PreviewTile
                label={t("employees.preview_monthly")}
                value={fmtMoney(rates.monthly)}
                primary={rates.primary === "monthly"}
              />
              <PreviewTile
                label={t("employees.preview_overtime")}
                value={fmtMoney(rates.overtimeHourly)}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label={t("employees.overtime_multiplier")}
            value={value.overtime_multiplier}
            onChange={(e) => set("overtime_multiplier", e.target.value)}
            type="number"
            min="1"
            max="5"
            step="0.1"
            hint={t("employees.overtime_multiplier_hint") ?? undefined}
          />
          <Input
            label={t("employees.bank_card")}
            value={value.bank_card_number}
            onChange={(e) => set("bank_card_number", e.target.value)}
            placeholder="8600 1234 5678 9012"
            maxLength={32}
            prefix={<Banknote className="size-4" />}
          />
          <Input
            label={t("employees.bank_name")}
            value={value.bank_name}
            onChange={(e) => set("bank_name", e.target.value)}
            placeholder="Hamkorbank"
            maxLength={120}
          />
        </div>
      </div>
    </Card>
  );
}

function PreviewTile({
  label,
  value,
  primary,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md bg-white/70 px-3 py-2 ring-1 ring-emerald-200",
        primary && "bg-white ring-2 ring-emerald-500"
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-emerald-700/70">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-900">
        {value}
      </div>
    </div>
  );
}
