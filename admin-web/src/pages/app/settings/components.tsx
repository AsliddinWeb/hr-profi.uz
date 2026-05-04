/** Shared visual primitives for the settings hub. */

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <header>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Read-only key/value tile — for things like plan/subscription/audit fields
 * the admin can see but not edit from this page. */
export function ReadonlyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-slate-800">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-slate-400">{hint}</div>}
    </div>
  );
}
