import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Building2,
  Calendar,
  CalendarDays,
  ClipboardCheck,
  Coins,
  Cpu,
  FileSpreadsheet,
  Gauge,
  Layers,
  LayoutDashboard,
  Menu,
  Network,
  Scroll,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Tablet,
  Trophy,
  Users,
  X,
} from "lucide-react";

import { LangSwitcher } from "@/components/LangSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { useAuthStore } from "@/stores/auth";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/cn";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

function ownerNav(t: (k: string) => string): NavSection[] {
  return [
    {
      label: t("nav.section_overview"),
      items: [
        { to: "/owner", label: t("nav.dashboard"), icon: LayoutDashboard },
        { to: "/owner/companies", label: t("nav.companies"), icon: Building2 },
        { to: "/owner/plans", label: t("nav.plans"), icon: Layers },
      ],
    },
  ];
}

function branchManagerNav(t: (k: string) => string): NavSection[] {
  // A trimmed-down sidebar for BRANCH_MANAGER. The pages share the same
  // routes as the company-admin nav — they re-render filtered to the
  // manager's branch via the apply_branch_scope helper on the backend. We
  // hide everything that doesn't apply (Plans, Companies, Branch CRUD, KPI
  // template authoring, Devices, Notification preferences, Audit etc.).
  return [
    {
      label: t("nav.section_overview"),
      items: [
        { to: "/app", label: t("nav.dashboard"), icon: LayoutDashboard },
      ],
    },
    {
      label: t("nav.section_org"),
      items: [
        { to: "/app/employees", label: t("nav.employees"), icon: Users },
      ],
    },
    {
      label: t("nav.section_time"),
      items: [
        { to: "/app/shifts", label: t("nav.shifts"), icon: Calendar },
        { to: "/app/attendance", label: t("nav.attendance"), icon: ClipboardCheck },
        { to: "/app/leaves", label: t("nav.leaves"), icon: CalendarDays },
      ],
    },
    {
      label: t("nav.section_money"),
      items: [
        { to: "/app/kpi", label: t("nav.kpi"), icon: Trophy },
      ],
    },
    {
      label: t("nav.section_admin"),
      items: [
        { to: "/app/notifications", label: t("nav.notifications"), icon: Bell },
        { to: "/app/reports", label: t("nav.reports"), icon: FileSpreadsheet },
      ],
    },
  ];
}


function companyNav(t: (k: string) => string): NavSection[] {
  return [
    {
      label: t("nav.section_overview"),
      items: [{ to: "/app", label: t("nav.dashboard"), icon: LayoutDashboard }],
    },
    {
      label: t("nav.section_org"),
      items: [
        { to: "/app/branches", label: t("nav.branches"), icon: Store },
        { to: "/app/departments", label: t("nav.departments"), icon: Network },
        { to: "/app/employees", label: t("nav.employees"), icon: Users },
      ],
    },
    {
      label: t("nav.section_time"),
      items: [
        { to: "/app/shifts", label: t("nav.shifts"), icon: Calendar },
        { to: "/app/attendance", label: t("nav.attendance"), icon: ClipboardCheck },
        { to: "/app/leaves", label: t("nav.leaves"), icon: CalendarDays },
      ],
    },
    {
      label: t("nav.section_money"),
      items: [
        { to: "/app/salary", label: t("nav.salary"), icon: Coins },
        { to: "/app/kpi", label: t("nav.kpi"), icon: Trophy },
      ],
    },
    {
      label: t("nav.section_admin"),
      items: [
        { to: "/app/devices", label: t("nav.devices"), icon: Cpu },
        { to: "/app/kiosks", label: t("nav.kiosks"), icon: Tablet },
        { to: "/app/notifications", label: t("nav.notifications"), icon: Bell },
        { to: "/app/users", label: t("nav.users"), icon: ShieldCheck },
        { to: "/app/audit", label: t("nav.audit"), icon: Scroll },
        { to: "/app/reports", label: t("nav.reports"), icon: FileSpreadsheet },
        { to: "/app/settings", label: t("nav.settings"), icon: Settings },
      ],
    },
  ];
}

export function Layout() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const collapsedPref = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const mobileOpen = useUIStore((s) => s.mobileSidebarOpen);
  const toggleMobile = useUIStore((s) => s.toggleMobileSidebar);
  const setMobile = useUIStore((s) => s.setMobileSidebar);
  const location = useLocation();
  // The mobile drawer always shows the full sidebar regardless of the user's
  // desktop "collapsed" preference. Treat ``collapsed`` as effectively false
  // while the drawer is open so labels + section headers all render.
  const collapsed = collapsedPref && !mobileOpen;

  const isOwner = user?.role === "OWNER";
  const isBranchManager = user?.role === "BRANCH_MANAGER";
  const sections = isOwner
    ? ownerNav(t)
    : isBranchManager
      ? branchManagerNav(t)
      : companyNav(t);

  // Auto-close the mobile drawer on every route change so the user sees the
  // page they navigated to instead of the still-open sidebar.
  useEffect(() => {
    setMobile(false);
  }, [location.pathname, setMobile]);

  // Lock body scroll while the drawer is open on mobile.
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [mobileOpen]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--page-bg)]">
      {/* Mobile backdrop — clicking closes the drawer */}
      {mobileOpen && (
        <div
          onClick={() => setMobile(false)}
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm md:hidden"
          aria-hidden
        />
      )}

      {/* ========== Sidebar ==========
          Desktop (md+): static, can collapse to 72px. Mobile: off-canvas
          drawer that slides in from the left.  */}
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-[var(--card-border)] bg-white transition-all duration-250",
          // Desktop sizing (md and up)
          "md:relative md:translate-x-0",
          collapsed ? "md:w-[72px]" : "md:w-64",
          // Mobile drawer
          "fixed inset-y-0 left-0 z-40 w-64 max-w-[80vw]",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            "flex h-16 items-center gap-2.5 border-b border-[var(--card-border)] px-4",
            collapsed && "justify-center px-0"
          )}
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
            <Gauge className="size-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold tracking-tight text-ink-900">
                {t("app.name")}
              </span>
              <span className="block text-[10px] uppercase tracking-wider text-ink-400">
                {isOwner ? t("layout.role_owner") : t("layout.role_workspace")}
              </span>
            </div>
          )}
          {/* Mobile-only close button */}
          <button
            onClick={() => setMobile(false)}
            className="btn-icon shrink-0 text-ink-500 md:hidden"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
          {sections.map((section, idx) => (
            <div key={section.label}>
              {!collapsed && <p className="nav-section">{section.label}</p>}
              {collapsed && idx > 0 && (
                <div className="my-3 border-t border-[var(--card-border)]" />
              )}
              <ul className="space-y-0.5">
                {section.items.map((it) => (
                  <li key={it.to}>
                    <NavLink
                      to={it.to}
                      end={it.to === "/owner" || it.to === "/app"}
                      title={collapsed ? it.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          "nav-link",
                          isActive && "nav-link-active",
                          collapsed && "justify-center px-0"
                        )
                      }
                    >
                      <it.icon className="size-4 shrink-0" />
                      {!collapsed && <span>{it.label}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Upgrade card — only visible when sidebar is expanded. Pinning the
            CTA to the bottom keeps it discoverable but not in the way. */}
        {!collapsed && (
          <div className="px-3 pb-3">
            <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-500 to-brand-700 p-4 text-white shadow-sm">
              <div className="mb-2 inline-flex size-8 items-center justify-center rounded-lg bg-white/20">
                <Sparkles className="size-4" />
              </div>
              <p className="text-sm font-semibold leading-tight">{t("layout.upgrade_title")}</p>
              <p className="mt-1 text-xs leading-snug text-brand-100">
                {t("layout.upgrade_subtitle")}
              </p>
            </div>
          </div>
        )}
      </aside>

      {/* ========== Main ========== */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-[var(--card-border)] bg-white px-3 sm:gap-3 sm:px-5">
          {/* Mobile hamburger — opens the drawer */}
          <button
            onClick={toggleMobile}
            className="btn-icon shrink-0 text-ink-600 md:hidden"
            aria-label="Open menu"
            title="Menu"
          >
            <Menu className="size-4" />
          </button>
          {/* Desktop sidebar collapse */}
          <button
            onClick={toggleSidebar}
            className="btn-icon hidden shrink-0 text-ink-600 md:inline-flex"
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
          >
            <Menu className="size-4" />
          </button>

          {/* Search — hidden on phones to keep room for the right cluster.
              On md+ takes a fixed-ish width so the bell/lang/user pin right. */}
          <div className="relative hidden w-full max-w-md md:block">
            <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-ink-400" />
            <input
              type="search"
              placeholder={t("layout.search_placeholder")}
              className="input pl-9"
            />
          </div>

          {/* Right cluster — pinned right. Stays visible on every viewport. */}
          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <NotificationBell />
            <ThemeToggle />
            <LangSwitcher />
            <span
              className="mx-1 hidden h-6 w-px bg-[var(--card-border)] sm:mx-1.5 sm:inline-block"
              aria-hidden
            />
            <UserMenu />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Padding scales: tighter on phone, normal on tablet+. */}
          <div className="mx-auto max-w-[1500px] px-3 pb-20 pt-4 sm:px-5 sm:pt-5 lg:px-6 lg:pb-24 lg:pt-6">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
