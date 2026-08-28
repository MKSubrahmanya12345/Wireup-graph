import { useEffect, useState } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';

import Toast from './Toast';
import { useGraphStore } from '../store/useGraphStore';
import { api } from '../services/api';
import { exportGraphPng, getViewportElement } from '../lib/exporters';
import { toFlowNodes } from '../lib/graphAdapter';
import { toast } from '../store/useToastStore';
import {
  ChipIcon,
  CodeIcon,
  DownloadIcon,
  GridIcon,
  SlidersIcon,
  WaveformIcon,
} from './Icons';

const NAV = [
  { to: '/', label: 'Architecture plan', Icon: GridIcon, end: true },
  { to: '/signal-map', label: 'Signal map', Icon: WaveformIcon },
  { to: '/firmware', label: 'Firmware surface', Icon: ChipIcon },
  { to: '/artifacts', label: 'Artifacts', Icon: CodeIcon },
];

export default function AppShell() {
  const graph = useGraphStore((state) => state.graph);
  const status = useGraphStore((state) => state.status);
  const loadProject = useGraphStore((state) => state.loadProject);
  const { projectId } = useParams();
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then(() => !cancelled && setApiOnline(true))
      .catch(() => !cancelled && setApiOnline(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep link: /projects/:projectId
  useEffect(() => {
    if (projectId) void loadProject(projectId);
  }, [projectId, loadProject]);

  const handleExport = async () => {
    const viewportEl = getViewportElement();
    if (!viewportEl || graph.nodes.length === 0) {
      toast('Open the architecture plan and generate something before exporting.');
      return;
    }
    try {
      await exportGraphPng(toFlowNodes(graph, null), graph, viewportEl);
      toast('PNG exported with the current node positions.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <div className="brand-name">
            ARCH / AI<small>hardware workspace</small>
          </div>
        </div>

        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              <span className="nav-icon">
                <Icon />
              </span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="project-mini">
          <div className="mini-caption">CURRENT PROJECT</div>
          <strong>{graph.project}</strong>
          <p>{graph.summary || 'Describe a system to generate a buildable plan.'}</p>
          <div className="mini-progress">
            <span style={{ width: `${Math.min(100, graph.nodes.length * 12)}%` }} />
          </div>
        </div>

        <div className="side-footer">
          <span>
            <i className="api-dot" style={{ background: apiOnline ? '#77c9a2' : '#c98a77' }} />
            {apiOnline === null ? 'checking…' : apiOnline ? 'API ready' : 'API offline'}
          </span>
          <span>v1.0.0</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumbs">
            <span>Projects</span>
            <span className="crumb-sep">/</span>
            <b>{graph.project}</b>
          </div>
          <div className="top-actions">
            <div className="status-chip">
              <i className="live-dot" style={{ background: status === 'planning' ? '#e5ae46' : '#6db89f' }} />
              <span>{status === 'planning' ? 'Planning…' : 'Architecture service online'}</span>
            </div>
            <button className="icon-button" aria-label="Workspace settings" onClick={() => toast('Workspace settings are local to this session.')}>
              <SlidersIcon className="svg-icon" />
            </button>
            <button className="export-button" data-testid="button-export-png" onClick={() => void handleExport()}>
              <DownloadIcon className="svg-icon" />
              <span>Export PNG</span>
            </button>
          </div>
        </header>

        <Outlet />
      </main>

      <Toast />
    </div>
  );
}