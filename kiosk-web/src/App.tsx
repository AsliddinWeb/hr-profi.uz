import { Navigate, Route, Routes, useParams } from "react-router-dom";

import { LoginPage } from "@/pages/LoginPage";
import { MainPage } from "@/pages/MainPage";
import { useAuthStore } from "@/stores/auth";

/* Routes:
 *   /                 → if signed in, kiosk's slug; otherwise login w/o slug
 *   /<slug>           → main split-screen (auth required, slug must match)
 *   /<slug>/login     → password prompt (slug pre-filled from URL)
 *
 * The slug appears in the URL so an operator can hand the tablet a
 * "your URL is kiosk.hr-profi.uz/<slug>" link from the admin panel and
 * skip retyping it. After successful login the slug is fixed by the
 * stored kiosk; we never let a signed-in tablet flip slugs. */

function RootRedirect() {
  const kiosk = useAuthStore((s) => s.kiosk);
  const accessToken = useAuthStore((s) => s.accessToken);
  if (accessToken && kiosk) {
    return <Navigate to={`/${kiosk.slug}`} replace />;
  }
  return <Navigate to="/login" replace />;
}

function SlugLoginRoute() {
  const { slug } = useParams<{ slug: string }>();
  return <LoginPage slugFromUrl={slug ?? null} />;
}

function SlugMainRoute() {
  const { slug } = useParams<{ slug: string }>();
  const kiosk = useAuthStore((s) => s.kiosk);
  const accessToken = useAuthStore((s) => s.accessToken);

  if (!accessToken || !kiosk) {
    return <Navigate to={`/${slug ?? ""}/login`} replace />;
  }
  // If the URL slug doesn't match the signed-in kiosk's slug, force the
  // canonical URL so bookmarks always resolve cleanly.
  if (slug && slug !== kiosk.slug) {
    return <Navigate to={`/${kiosk.slug}`} replace />;
  }
  return <MainPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage slugFromUrl={null} />} />
      <Route path="/:slug/login" element={<SlugLoginRoute />} />
      <Route path="/:slug" element={<SlugMainRoute />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
