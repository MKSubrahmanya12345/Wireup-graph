import { NavLink, useNavigate } from 'react-router-dom';

import { WireupWordmark } from './Brand';
import { useAuth } from '../store/useAuth';
import { useBuildStore } from '../store/useBuildStore';
import { useDesignSession } from '../store/useDesignSession';
import { useGraphStore } from '../store/useGraphStore';

// Old STEPS commented out per Rule 2:
// const STEPS = [
//   { to: '/', label: 'Projects', step: '00', end: true },
//   { to: '/design', label: 'Prompt & Questions', step: '01' },
//   { to: '/graph', label: 'Graph', step: '02' },
//   { to: '/build', label: 'Agentic Build', step: '03' },
// ];

// ??$$$ Updated STEPS including Hardware Spec Graph step (01.5) and the
// simulator (04). The simulator is a first-class page now, not a side door off
// page 03: a build runs as a server-side job, so you can sit on 04 running the
// generated website while 03 is still writing the firmware.
const STEPS = [
  { to: '/', label: 'Projects', step: '00', end: true },
  { to: '/design', label: 'Prompt & Questions', step: '01' },
  { to: '/spec-graph', label: 'Spec Graph', step: '01.5' },
  { to: '/graph', label: 'Graph', step: '02' },
  { to: '/build', label: 'Agentic Build', step: '03' },
  { to: '/sim', label: 'Simulation', step: '04' },
];

/**
 * Top navigation: brand, the workbench + three-step pipeline, API status, and
 * the user. This replaces the old sidebar — the product is a project list
 * plus a three-page flow.
 */
export default function TopNav() {
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);
  const navigate = useNavigate();
  const stage = useDesignSession((state) => state.stage);
  const nodeCount = useGraphStore((state) => state.graph.nodes.length);
  const project = useGraphStore((state) => state.graph.project);
  const buildRunning = useBuildStore((state) => state.running);
  const buildProgress = useBuildStore((state) => state.progress);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Which half of the in-flight build is usable — so the nav tells you that you
  // can go run the website while the firmware is still being written.
  const buildNote = buildRunning
    ? buildProgress?.website?.ready
      ? 'website live · firmware building'
      : 'website building'
    : null;

  return (
    <header className="topnav">
      <NavLink to="/" className="topnav-brand" aria-label="Wireup home">
        <WireupWordmark size={30} />
      </NavLink>

      <nav className="topnav-steps" aria-label="Pipeline">
        {STEPS.map(({ to, label, step, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `step-link${isActive ? ' active' : ''}`}
          >
            <span className="step-index">{step}</span>
            <span className="step-name">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="topnav-right">
        {buildNote && (
          <NavLink to={buildProgress?.website?.ready ? '/sim' : '/build'} className="build-live-chip" title="A build is running on the server — it keeps going while you use other pages">
            <i className="live-dot busy" />
            {buildNote}
          </NavLink>
        )}
        <span className="nav-status" title={project}>
          <i className={`live-dot${stage === 'planning' || stage === 'interpreting' ? ' busy' : ''}`} />
          {nodeCount > 0 ? `${project} · ${nodeCount} nodes` : 'No design yet'}
        </span>
        <NavLink to="/billing" className="ghost-button small as-link">
          Plan
        </NavLink>
        {user?.role === 'admin' && (
          <NavLink to="/admin" className="ghost-button small as-link">
            Admin
          </NavLink>
        )}
        {user && (
          <div className="user-chip">
            <span className="user-avatar" aria-hidden="true">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="user-name">{user.name}</span>
            <button type="button" className="ghost-button small" onClick={handleLogout}>
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
