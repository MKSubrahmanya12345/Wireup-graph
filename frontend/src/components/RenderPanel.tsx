import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useGraphStore } from '../store/useGraphStore';
import { useToastStore } from '../store/useToastStore';

interface RenderState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
  url?: string;
  prompt?: string;
  negativePrompt?: string;
  cached?: boolean;
  error?: string;
}

/**
 * RenderPanel: hero photorealistic image derived from the graph.
 * Shows the prompt used (audit trail), angle selector, and retry controls.
 * Placed above the 3D + 2D graph split in ArchitecturePlanPage.
 */
export default function RenderPanel() {
  const graph = useGraphStore((state) => state.graph);
  const projectId = useGraphStore((state) => state.projectId);
  const [render, setRender] = useState<RenderState>({ status: 'idle' });
  const [angle, setAngle] = useState<string>('three-quarter');
  const [showPrompt, setShowPrompt] = useState(false);

  // Clear render when graph is invalidated (new plan)
  useEffect(() => {
    if (graph.nodes.length === 0) {
      setRender({ status: 'idle' });
    }
  }, [graph.project, graph.nodes.length]); // Depend on graph identity

  async function performRender(force: boolean) {
    if (graph.nodes.length === 0) {
      setRender({ status: 'unavailable', error: 'No architecture to render' });
      return;
    }

    setRender({ status: 'loading' });

    try {
      const result = await api.renderArchitecture({
        graph,
        projectId: projectId ?? undefined,
        force,
        angle,
      });

      if (result.status === 'ready' && result.url) {
        setRender({
          status: 'ready',
          url: result.url,
          prompt: result.prompt,
          negativePrompt: result.negativePrompt,
          cached: result.cached,
        });
      } else if (result.status === 'unavailable') {
        setRender({
          status: 'unavailable',
          error: 'Image generation is not available. Check backend configuration.',
        });
      } else {
        // pending or unknown status
        setRender({
          status: 'loading',
          error: 'Image generation is pending. Try again in a moment.',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setRender({
        status: 'error',
        error: message,
      });
      useToastStore.getState().show(`Render failed: ${message}`);
    }
  }

  const handleRegenerate = () => {
    performRender(true);
  };

  const handleAngleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newAngle = e.target.value;
    setAngle(newAngle);
    // Don't auto-trigger; user must click generate
    setShowPrompt(false);
  };

  // Trigger render only when user clicks generate, not on angle change
  useEffect(() => {
    // This is intentionally empty — we only render on user action now
  }, [angle]);

  if (graph.nodes.length === 0) {
    return (
      <section className="render-panel render-empty">
        <header className="panel-bar">
          <div className="panel-title">
            <span className="bar-mark" style={{ background: 'var(--accent)' }} />
            Photorealistic render
          </div>
          <span className="panel-mono">/ WAITING FOR PLAN</span>
        </header>
        <div className="render-placeholder">
          <p>Generate an architecture plan to unlock photorealistic rendering.</p>
        </div>
      </section>
    );
  }

  if (render.status === 'idle') {
    return (
      <section className="render-panel render-idle">
        <header className="panel-bar">
          <div className="panel-title">
            <span className="bar-mark" style={{ background: 'var(--accent)' }} />
            Photorealistic render
          </div>
          <div className="render-controls">
            <select
              value={angle}
              onChange={handleAngleChange}
              className="render-angle-select"
              title="Camera angle"
            >
              <option value="three-quarter">Three-quarter</option>
              <option value="side">Side</option>
              <option value="front">Front</option>
              <option value="top">Top</option>
            </select>
            <button
              onClick={() => performRender(false)}
              className="render-generate-btn"
              title="Generate photorealistic image"
            >
              Generate
            </button>
          </div>
        </header>
        <div className="render-placeholder">
          <p>Click "Generate" to create a photorealistic render from this architecture.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`render-panel render-${render.status}`}>
      <header className="panel-bar">
        <div className="panel-title">
          <span className="bar-mark" style={{ background: 'var(--accent)' }} />
          Photorealistic render
          {render.cached && <span className="render-cached-badge">cached</span>}
        </div>
        <div className="render-controls">
          <select
            value={angle}
            onChange={handleAngleChange}
            className="render-angle-select"
            title="Camera angle"
          >
            <option value="three-quarter">Three-quarter</option>
            <option value="side">Side</option>
            <option value="front">Front</option>
            <option value="top">Top</option>
          </select>
          {render.status === 'ready' && (
            <button
              onClick={handleRegenerate}
              className="render-regenerate-btn"
              title="Force regenerate"
            >
              ↻
            </button>
          )}
        </div>
      </header>

      {render.status === 'loading' && (
        <div className="render-skeleton">
          <div className="skeleton-image" />
          <div className="skeleton-text" />
        </div>
      )}

      {render.status === 'ready' && render.url && (
        <div className="render-body">
          <div className="render-image-container">
            <img src={render.url} alt="Photorealistic hardware assembly" className="render-image" />
          </div>

          <div className="render-metadata">
            <div className="render-badge">
              Rendered from data · {graph.nodes.length} components · illustrative, verify against graph
            </div>

            <button
              onClick={() => setShowPrompt(!showPrompt)}
              className="render-prompt-toggle"
            >
              {showPrompt ? '▼' : '▶'} What I described
            </button>

            {showPrompt && (
              <div className="render-prompt-box">
                <p className="render-prompt-label">Prompt used:</p>
                <pre className="render-prompt-text">{render.prompt}</pre>
                {render.negativePrompt && (
                  <>
                    <p className="render-prompt-label">Negative prompt:</p>
                    <pre className="render-prompt-text">{render.negativePrompt}</pre>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {render.status === 'error' && (
        <div className="render-error">
          <p className="render-error-title">Render failed</p>
          <p className="render-error-detail">{render.error}</p>
          <button onClick={() => performRender(false)} className="render-retry-btn">
            Retry
          </button>
        </div>
      )}

      {render.status === 'unavailable' && (
        <div className="render-unavailable">
          <p className="render-error-title">Image generation unavailable</p>
          <p className="render-error-detail">{render.error}</p>
          <p className="render-error-hint">
            Check that Cloudflare credentials are configured in backend/.env
          </p>
          <button onClick={() => performRender(false)} className="render-retry-btn">
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
