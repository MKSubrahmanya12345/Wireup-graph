import { Route, Routes } from 'react-router-dom';

import AppShell from './components/AppShell';
import ArchitecturePlanPage from './pages/ArchitecturePlanPage';
import SignalMapPage from './pages/SignalMapPage';
import FirmwareSurfacePage from './pages/FirmwareSurfacePage';
import ArtifactsPage from './pages/ArtifactsPage';
import NotFoundPage from './pages/NotFoundPage';

/**
 * Route table. BrowserRouter lives in main.tsx so that <App /> stays
 * testable — wrap it in MemoryRouter when you add tests.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<ArchitecturePlanPage />} />
        <Route path="signal-map" element={<SignalMapPage />} />
        <Route path="firmware" element={<FirmwareSurfacePage />} />
        <Route path="artifacts" element={<ArtifactsPage />} />
        <Route path="projects/:projectId" element={<ArchitecturePlanPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
