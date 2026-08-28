import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useGraphStore } from '../store/useGraphStore';
import { api } from '../services/api';
import { exportGraphJson, exportGraphPng, getViewportElement } from '../lib/exporters';
import { toFlowNodes } from '../lib/graphAdapter';
import { toast } from '../store/useToastStore';
import type { ProjectSummary } from '../types/architecture';

export default function ArtifactsPage() {
  const graph = useGraphStore((state) => state.graph);
  const projectId = useGraphStore((state) => state.projectId);
  const loadProject = useGraphStore((state) => state.loadProject);
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await api.listProjects());
      setUnavailable(false);
    } catch {
      setUnavailable(true);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleExportPng = async () => {
    const viewportEl = getViewportElement();
    if (!viewportEl || graph.nodes.length === 0) {
      toast('Generate a plan on the Architecture page before exporting a PNG.');
      return;
    }
    try {
      await exportGraphPng(toFlowNodes(graph, null), graph, viewportEl);
      toast('PNG exported.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  return (
    <>
      <section className="heading-row">
        <div>
          <div className="eyebrow">Architecture workspace / 04</div>
          <h1>Artifacts</h1>
          <p className="heading-sub">Export the current plan, or reopen a saved project.</p>
        </div>
        <div className="header-meta">
          <span>{String(projects.length).padStart(2, '0')} SAVED</span>
        </div>
      </section>

      <section className="details-grid">
        <article className="detail-card">
          <header>
            <h3>Export current plan</h3>
            <span className="card-count">{graph.project}</span>
          </header>
          <div className="detail-list">
            <button type="button" className="plan-button" onClick={() => void handleExportPng()}>
              <span className="button-label">Export PNG</span>
              <span className="button-arrow">↗</span>
            </button>
            <button
              type="button"
              className="suggestion"
              onClick={() => {
                exportGraphJson(graph);
                toast('Graph JSON downloaded.');
              }}
            >
              Download graph JSON
            </button>
          </div>
        </article>

        <article className="detail-card span-2">
          <header>
            <h3>Saved projects</h3>
            <span className="card-count">
              {unavailable ? 'PERSISTENCE OFF' : loading ? 'LOADING' : 'MONGODB'}
            </span>
          </header>
          <div className="detail-list">
            {unavailable ? (
              <span className="panel-mono">
                Persistence is disabled — set MONGO_URI in backend/.env to save projects.
              </span>
            ) : loading ? (
              <span className="panel-mono">Loading…</span>
            ) : projects.length === 0 ? (
              <span className="panel-mono">No saved projects yet.</span>
            ) : (
              projects.map((project) => (
                <div className="detail-row" key={project.id}>
                  <div className="main-label">
                    <i className="connector" />
                    <button
                      type="button"
                      className="linkish"
                      onClick={async () => {
                        await loadProject(project.id);
                        navigate('/');
                      }}
                    >
                      {project.name}
                    </button>
                  </div>
                  <span className="value">
                    {project.id === projectId ? 'current · ' : ''}
                    {project.nodeCount} nodes
                  </span>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </>
  );
}