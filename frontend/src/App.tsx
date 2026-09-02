import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import TopNav from './components/TopNav';
import Toast from './components/Toast';
import AdminPage from './pages/AdminPage';
import AuthPage from './pages/AuthPage';
import BillingPage from './pages/BillingPage';
import BuildPage from './pages/BuildPage';
import GraphPage from './pages/GraphPage';
import IntakePage from './pages/IntakePage';
import ProjectsPage from './pages/ProjectsPage';
import SimPage from './pages/SimPage';
// ??$$$ SpecGraph live document page import
import SpecGraphPage from './pages/SpecGraphPage';
import { useAuth } from './store/useAuth';

function Workspace({ children }: { children: ReactNode }) {
  return (
    <div className="workspace">
      <TopNav />
      <main className="workspace-main">{children}</main>
      <Toast />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuth((state) => state.user);
  const bootstrapped = useAuth((state) => state.bootstrapped);
  const location = useLocation();

  if (!bootstrapped) {
    return (
      <div className="boot-splash">
        <div className="boot-mark">⚡</div>
        <span>Wireup is warming up…</span>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Workspace>{children}</Workspace>;
}

/**
 * Public shell: same workspace chrome, but NO login wall. Used for the
 * simulator so the one-click demo project works without an account.
 * Everything that truly needs auth (projects, real builds, billing, admin)
 * stays behind RequireAuth; the API enforces the same split server-side.
 */
function PublicShell({ children }: { children: ReactNode }) {
  const bootstrapped = useAuth((state) => state.bootstrapped);

  if (!bootstrapped) {
    return (
      <div className="boot-splash">
        <div className="boot-mark">⚡</div>
        <span>Wireup is warming up…</span>
      </div>
    );
  }
  return <Workspace>{children}</Workspace>;
}

/**
 * Admin-only gate. A logged-in non-admin sees an explicit 403 panel instead
 * of the console (the API enforces the same rule server-side — this is UX,
 * not security).
 */
function RequireAdmin({ children }: { children: ReactNode }) {
  const user = useAuth((state) => state.user);
  if (user && user.role !== 'admin') {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-mark">⛔</div>
          <h1>403 — admin only</h1>
          <p className="muted">
            This console is restricted to Wireup administrators. Signed in as {user.email}.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Wireup — a workbench homepage plus the three-page pipeline behind a login:
 *   00 projects · 01 prompt & questions · 02 architecture graph · 03 agentic build.
 */
export default function App() {
  const bootstrap = useAuth((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <ProjectsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/design"
        element={
          <RequireAuth>
            <IntakePage />
          </RequireAuth>
        }
      />
      {/* ??$$$ Hardware Spec Graph Live Document Page */}
      <Route
        path="/spec-graph"
        element={
          <RequireAuth>
            <SpecGraphPage />
          </RequireAuth>
        }
      />
      <Route
        path="/graph"
        element={
          <RequireAuth>
            <GraphPage />
          </RequireAuth>
        }
      />
      <Route
        path="/build"
        element={
          <RequireAuth>
            <BuildPage />
          </RequireAuth>
        }
      />
      <Route
        path="/billing"
        element={
          <RequireAuth>
            <BillingPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/sim"
        element={
          <PublicShell>
            <SimPage />
          </PublicShell>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
