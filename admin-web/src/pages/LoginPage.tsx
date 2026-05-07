import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Gauge } from "lucide-react";

import { api, apiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import type { TokenPair, User } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LangSwitcher } from "@/components/LangSwitcher";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const logout = useAuthStore((s) => s.logout);

  // Roles allowed to use the admin web. EMPLOYEE / DEVICE / KIOSK
  // accounts authenticate against /auth/login successfully (the
  // backend doesn't gate by role at login — it just hands out a token
  // with the role baked in), but they have no admin permissions, so
  // every page they land on returns 403. Catch them here and bounce
  // back to the right surface.
  const ADMIN_ROLES = new Set([
    "OWNER",
    "COMPANY_ADMIN",
    "HR_MANAGER",
    "BRANCH_MANAGER",
  ]);
  const PWA_URL = "https://my.hr-profi.uz";

  const mutation = useMutation({
    mutationFn: async (creds: { username: string; password: string }) => {
      const { data } = await api.post<TokenPair>("/auth/login", creds);
      setTokens(data);
      const me = await api.get<User>("/auth/me");
      if (!ADMIN_ROLES.has(me.data.role)) {
        // Wrong app for this account. Drop the freshly-set tokens so
        // we don't leave a half-logged-in state that ProtectedRoute
        // would happily honour.
        logout();
        if (me.data.role === "EMPLOYEE") {
          throw new Error(t("auth.employee_use_pwa", { url: PWA_URL }));
        }
        throw new Error(t("auth.role_not_allowed"));
      }
      setUser(me.data);
      return me.data;
    },
    onSuccess: (me) => {
      navigate(me.role === "OWNER" ? "/owner" : "/app", { replace: true });
    },
  });

  if (accessToken) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <div className="flex justify-end p-4">
        <LangSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="card w-full max-w-md">
          <div className="card-body">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md bg-brand-600 text-white">
                <Gauge className="size-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">{t("app.name")}</h1>
                <p className="text-xs text-slate-500">{t("app.tagline")}</p>
              </div>
            </div>
            <h2 className="mb-1 text-xl font-semibold">{t("auth.sign_in")}</h2>
            <p className="mb-6 text-sm text-slate-500">{t("auth.sign_in_subtitle")}</p>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate({ username, password });
              }}
            >
              <Input
                label={t("auth.username")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
                autoComplete="username"
              />
              <Input
                type="password"
                label={t("auth.password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              {mutation.isError && (
                <p className="text-sm text-red-600">{apiErrorMessage(mutation.error)}</p>
              )}
              <Button type="submit" loading={mutation.isPending} className="w-full">
                {mutation.isPending ? t("auth.logging_in") : t("auth.submit")}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
