import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import TopNav from './components/TopNav';
import Toast from './components/Toast';
import AuthPage from './pages/AuthPage';
import BuildPage from './pages/BuildPage';
import GraphPage from './pages/GraphPage';
import IntakePage from './pages/IntakePage';
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
 * Wireup — three pages behind a login:
 *   01 prompt & questions · 02 architecture graph · 03 agentic build.
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
            <IntakePage />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
