import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";

import { LoginPage } from "@/pages/LoginPage";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { OwnerDashboard } from "@/pages/owner/Dashboard";
import { CompaniesListPage } from "@/pages/owner/companies/CompaniesListPage";
import { CompanyCreatePage } from "@/pages/owner/companies/CompanyCreatePage";
import { CompanyEditPage } from "@/pages/owner/companies/CompanyEditPage";
import { PlansPage } from "@/pages/owner/PlansPage";
import { AppDashboard } from "@/pages/app/Dashboard";
import { BranchDashboard } from "@/pages/app/BranchDashboard";
import { BranchesListPage } from "@/pages/app/branches/BranchesList";
import { BranchCreatePage } from "@/pages/app/branches/BranchCreate";
import { BranchEditPage } from "@/pages/app/branches/BranchEdit";
import { DevicesListPage } from "@/pages/app/devices/DevicesListPage";
import { DeviceCreatePage } from "@/pages/app/devices/DeviceCreatePage";
import { DeviceEditPage } from "@/pages/app/devices/DeviceEditPage";
import { KiosksListPage } from "@/pages/app/kiosks/KiosksListPage";
import { KioskCreatePage } from "@/pages/app/kiosks/KioskCreatePage";
import { EmployeesListPage } from "@/pages/app/employees/EmployeesList";
import { EmployeeCreatePage } from "@/pages/app/employees/EmployeeCreate";
import { EmployeeEditPage } from "@/pages/app/employees/EmployeeEdit";
import { AttendanceHubPage } from "@/pages/app/attendance/AttendanceHubPage";
import { LeavesHubPage } from "@/pages/app/leaves/LeavesHubPage";
import { LeaveCreatePage } from "@/pages/app/leaves/LeaveCreatePage";
import { LeaveEditPage } from "@/pages/app/leaves/LeaveEditPage";
import { LeaveTypeCreatePage } from "@/pages/app/leaves/LeaveTypeCreatePage";
import { LeaveTypeEditPage } from "@/pages/app/leaves/LeaveTypeEditPage";
import { LeaveAdjustmentCreatePage } from "@/pages/app/leaves/LeaveAdjustmentCreatePage";
import { UsersListPage } from "@/pages/app/users/UsersListPage";
import { UserCreatePage } from "@/pages/app/users/UserCreatePage";
import { UserEditPage } from "@/pages/app/users/UserEditPage";
import { SalaryHubPage } from "@/pages/app/salary/SalaryHubPage";
import { EmployeeBreakdownPage } from "@/pages/app/salary/EmployeeBreakdownPage";
import { TransactionCreatePage } from "@/pages/app/salary/TransactionCreatePage";
import { KpiHubPage } from "@/pages/app/kpi/KpiHubPage";
import { DepartmentsListPage } from "@/pages/app/departments/DepartmentsList";
import { DepartmentCreatePage } from "@/pages/app/departments/DepartmentCreate";
import { DepartmentEditPage } from "@/pages/app/departments/DepartmentEdit";
import { ShiftsHubPage } from "@/pages/app/shifts/ShiftsHubPage";
import { TemplateCreatePage } from "@/pages/app/shifts/TemplateCreate";
import { TemplateEditPage } from "@/pages/app/shifts/TemplateEdit";
import { SettingsHubPage } from "@/pages/app/settings/SettingsHubPage";
import { NotificationsPage } from "@/pages/app/notifications/NotificationsPage";
import { AuditLogsPage } from "@/pages/app/audit/AuditLogsPage";
import { ReportsHubPage } from "@/pages/app/reports/ReportsHubPage";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

function RootRedirect() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <Navigate to="/login" replace />;
  if (!user) return null;
  return <Navigate to={user.role === "OWNER" ? "/owner" : "/app"} replace />;
}

/** Pick the right dashboard for the role at /app. BMs get a focused
 *  branch view; CA/HR get the full company dashboard. */
function DashboardSwitcher() {
  const role = useAuthStore((s) => s.user?.role);
  return role === "BRANCH_MANAGER" ? <BranchDashboard /> : <AppDashboard />;
}

export default function App() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  // If we have a token but no profile (e.g. after a hard reload), rehydrate.
  useEffect(() => {
    if (accessToken && !user) {
      void api
        .get<User>("/auth/me")
        .then((r) => setUser(r.data))
        .catch(() => {});
    }
  }, [accessToken, user, setUser]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute allow={["OWNER"]} />}>
        <Route path="/owner" element={<Layout />}>
          <Route index element={<OwnerDashboard />} />
          <Route path="companies" element={<CompaniesListPage />} />
          <Route path="companies/new" element={<CompanyCreatePage />} />
          <Route path="companies/:id/edit" element={<CompanyEditPage />} />
          <Route path="plans" element={<PlansPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/app" element={<Layout />}>
          <Route index element={<DashboardSwitcher />} />
          <Route path="branches" element={<BranchesListPage />} />
          <Route path="branches/new" element={<BranchCreatePage />} />
          <Route path="branches/:id/edit" element={<BranchEditPage />} />
          <Route path="departments" element={<DepartmentsListPage />} />
          <Route path="departments/new" element={<DepartmentCreatePage />} />
          <Route path="departments/:id/edit" element={<DepartmentEditPage />} />
          <Route path="employees" element={<EmployeesListPage />} />
          <Route path="employees/new" element={<EmployeeCreatePage />} />
          <Route path="employees/:id/edit" element={<EmployeeEditPage />} />
          <Route path="shifts" element={<ShiftsHubPage />} />
          <Route path="shifts/templates/new" element={<TemplateCreatePage />} />
          <Route path="shifts/templates/:id/edit" element={<TemplateEditPage />} />
          <Route path="attendance" element={<AttendanceHubPage />} />
          <Route path="salary" element={<SalaryHubPage />} />
          <Route path="salary/employee/:id" element={<EmployeeBreakdownPage />} />
          <Route path="salary/transactions/new" element={<TransactionCreatePage />} />
          <Route path="leaves" element={<LeavesHubPage />} />
          <Route path="leaves/new" element={<LeaveCreatePage />} />
          <Route path="leaves/:id/edit" element={<LeaveEditPage />} />
          <Route path="leaves/types/new" element={<LeaveTypeCreatePage />} />
          <Route path="leaves/types/:id/edit" element={<LeaveTypeEditPage />} />
          <Route path="leaves/balances/new" element={<LeaveAdjustmentCreatePage />} />
          <Route path="kpi" element={<KpiHubPage />} />
          <Route path="devices" element={<DevicesListPage />} />
          <Route path="devices/new" element={<DeviceCreatePage />} />
          <Route path="devices/:id/edit" element={<DeviceEditPage />} />
          <Route path="kiosks" element={<KiosksListPage />} />
          <Route path="kiosks/new" element={<KioskCreatePage />} />
          <Route path="users" element={<UsersListPage />} />
          <Route path="users/new" element={<UserCreatePage />} />
          <Route path="users/:id/edit" element={<UserEditPage />} />
          <Route path="settings" element={<SettingsHubPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="audit" element={<AuditLogsPage />} />
          <Route path="reports" element={<ReportsHubPage />} />
        </Route>
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
