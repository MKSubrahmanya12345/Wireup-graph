import { NavLink, useNavigate } from 'react-router-dom';

import { WireupWordmark } from './Brand';
import { useAuth } from '../store/useAuth';
import { useDesignSession } from '../store/useDesignSession';
import { useGraphStore } from '../store/useGraphStore';

const STEPS = [
  { to: '/', label: 'Projects', step: '00', end: true },
  { to: '/design', label: 'Prompt & Questions', step: '01' },
  { to: '/graph', label: 'Graph', step: '02' },
  { to: '/build', label: 'Agentic Build', step: '03' },
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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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
