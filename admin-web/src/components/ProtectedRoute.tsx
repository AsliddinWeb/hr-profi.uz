import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import type { Role } from "@/lib/types";

interface Props {
  allow?: Role[];
}

export function ProtectedRoute({ allow }: Props) {
  const location = useLocation();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (allow && user && !allow.includes(user.role)) {
    return <Navigate to={user.role === "OWNER" ? "/owner" : "/app"} replace />;
  }
  return <Outlet />;
}
