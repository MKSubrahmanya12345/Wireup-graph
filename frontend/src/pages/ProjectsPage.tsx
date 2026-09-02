import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../services/api';
import { useBuildStore } from '../store/useBuildStore';
import { useDesignSession } from '../store/useDesignSession';
import { useProjectsStore } from '../store/useProjectsStore';
import { toast } from '../store/useToastStore';
import type { ProjectSummary } from '../types/architecture';

const SUGGESTIONS = [
  'a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer',
  'esp32 with a soil moisture sensor and a relay to water my plant when dry — dashboard on my pc',
  'esp32 + bme280 weather station logging to a website i can open at home',
  'esp32 cam-free security: pir motion sensor + buzzer + led, web dashboard on my laptop',
];

/** Compact "2h ago / Sep 2" stamp for the project cards. */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Page 00 — the workbench homepage.
 *
 * Every signed-in account gets MANY projects: type a prompt and you are taken
 * to page 01 with it, or open a saved project straight from the list. Each
 * design session files into its own project — never one shared slot.
 */
export default function ProjectsPage() {
  const navigate = useNavigate();

  const projects = useProjectsStore((state) => state.projects);
  const status = useProjectsStore((state) => state.status);
  const mode = useProjectsStore((state) => state.mode);
  const error = useProjectsStore((state) => state.error);
  const refresh = useProjectsStore((state) => state.refresh);
  const loadDetail = useProjectsStore((state) => state.loadDetail);
  const remove = useProjectsStore((state) => state.remove);

  const beginProject = useDesignSession((state) => state.beginProject);
  const hydrateProject = useDesignSession((state) => state.hydrateProject);
  const loadResult = useBuildStore((state) => state.loadResult);

  const [brief, setBrief] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Prompt box → page 01. The session auto-starts interpretation there. */
  const startNewProject = () => {
    const text = brief.trim();
    if (!text) return;
    beginProject(text);
    navigate('/design');
  };

  /** One click: fetch the pre-baked weather-station project → land on /sim. */
  const jumpToDemo = async () => {
    setDemoBusy(true);
    setDemoError(null);
    try {
      const { result } = await api.demoBuild();
      loadResult(result);
      navigate('/sim');
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : 'Could not load the demo project.');
    } finally {
      setDemoBusy(false);
    }
  };

  const openProject = async (id: string) => {
    if (openingId) return;
    setOpeningId(id);
    try {
      const detail = await loadDetail(id);
      hydrateProject(detail);
      // A project with a graph lands on its architecture; a bare one goes to
      // the prompt page so the pipeline can pick it up.
      navigate(detail.nodeCount > 0 ? '/graph' : '/design');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not open that project.');
    } finally {
      setOpeningId(null);
    }
  };

  const deleteProject = async (project: ProjectSummary) => {
    if (!window.confirm(`Delete “${project.name}”? This cannot be undone.`)) return;
    try {
      await remove(project.id);
      toast('Project deleted.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that project.');
    }
  };

  return (
    <div className="page projects-page">
      <section className="projects-hero">
        <div className="eyebrow">your workbench · every build its own project</div>
        <h1>
          What are we <span className="accent-text">wiring up</span>?
        </h1>
        <p className="muted">
          Describe the parts on your bench and what you want them to do. Wireup files each
          build as its own project — start one below or pick up a saved one.
        </p>
      </section>

      <section className="composer-card">
        <textarea
          className="brief-input"
          rows={4}
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="e.g. a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer"
        />
        <div className="composer-foot">
          <div className="suggestion-row">
            {SUGGESTIONS.map((suggestion, i) => (
              <button
                key={suggestion}
                type="button"
                className="suggestion-chip"
                title={suggestion}
                onClick={() => setBrief(suggestion)}
              >
                {i === 0 ? '⭐ ' : ''}
                {suggestion.length > 64 ? `${suggestion.slice(0, 64)}…` : suggestion}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={!brief.trim()}
            onClick={startNewProject}
          >
            Start this build →
          </button>
        </div>
      </section>

      <div className="demo-jump">
        <button type="button" className="demo-jump-btn" onClick={() => void jumpToDemo()} disabled={demoBusy}>
          {demoBusy ? 'Loading the demo project…' : '⚡ Skip the pipeline — demo weather station → simulator'}
        </button>
        <span className="tiny muted">
          Pre-baked: “esp32 + bme280 weather station logging to a website i can open at home”.
          Lands you on page 04 with the circuit, the code and the live website.
        </span>
        {demoError && <span className="tiny bad">{demoError}</span>}
      </div>

      <section className="projects-section">
        <div className="projects-head">
          <div>
            <div className="eyebrow">saved projects</div>
            <h2>
              {status === 'loading' ? 'Loading…' : `${projects.length} project${projects.length === 1 ? '' : 's'}`}
            </h2>
          </div>
          <div className="projects-head-note">
            {mode === 'local' ? (
              <span className="tiny muted">
                No database configured — projects are saved in this browser (set MONGO_URI on the API to sync them).
              </span>
            ) : (
              <button type="button" className="ghost-button small" onClick={() => void refresh()}>
                ↻ Refresh
              </button>
            )}
          </div>
        </div>

        {status === 'error' && <div className="inline-error">{error}</div>}

        {status !== 'error' && projects.length === 0 && status !== 'loading' && (
          <div className="empty-state projects-empty">
            <div className="empty-mark">◈</div>
            <h2>No projects yet</h2>
            <p className="muted">
              Type a build above — it will show up here, and each new prompt becomes its own project.
            </p>
          </div>
        )}

        <div className="projects-grid">
          {projects.map((project) => (
            <article
              key={project.id}
              className="project-card"
              onClick={() => void openProject(project.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void openProject(project.id);
                }
              }}
            >
              <h3>{project.name}</h3>
              <p className="pc-summary">{project.summary || 'No summary yet.'}</p>
              <div className="pc-meta">
                <span>◈ {project.nodeCount} nodes</span>
                <span aria-hidden="true">·</span>
                <span>{formatWhen(project.updatedAt)}</span>
              </div>
              <div className="pc-actions">
                <button
                  type="button"
                  className="primary-button small as-link"
                  disabled={openingId === project.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void openProject(project.id);
                  }}
                >
                  {openingId === project.id ? 'Opening…' : 'Open →'}
                </button>
                <button
                  type="button"
                  className="ghost-button small pc-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteProject(project);
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
