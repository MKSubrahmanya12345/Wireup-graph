// ??$$$ Hardware Project Spec Graph Live Document & Graph Viewer with AI Loader Screen & Doubt Modal Loop
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useDesignSession } from '../store/useDesignSession';
import { useGraphStore } from '../store/useGraphStore';
import GraphCanvas from '../components/GraphCanvas';

const LOADER_STEPS = [
  'Reading brief & analyzing hardware constraints…',
  'Running domain capability-gap decomposition pass…',
  'Evaluating 3-part Ask/Decide gating rules…',
  'Building nodes, dependency edges & assumption logs…',
  'Synthesizing 2D/3D Architecture Graph twin…',
];

export default function SpecGraphPage() {
  const navigate = useNavigate();
  const brief = useDesignSession((state) => state.brief);
  const setBrief = useDesignSession((state) => state.setBrief);
  // ??$$$ Store-persisted answers & spec graph
  const answers = useDesignSession((state) => state.answers);
  const setAnswer = useDesignSession((state) => state.setAnswer);
  const storeSpecGraph = useDesignSession((state) => state.specGraph);
  const setStoreSpecGraph = useDesignSession((state) => state.setSpecGraph);
  const setGraph = useGraphStore((state) => state.setGraph);

  const [loading, setLoading] = useState<boolean>(true);
  const [loadingStep, setLoadingStep] = useState<number>(0);
  const [loadingProgress, setLoadingProgress] = useState<number>(15);
  const [error, setError] = useState<string | null>(null);
  const [specGraph, setSpecGraph] = useState<any>(storeSpecGraph);
  const [archGraph, setArchGraph] = useState<any>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [selectedAnswerMap, setSelectedAnswerMap] = useState<Record<string, string>>(answers ?? {});
  const [answering, setAnswering] = useState<boolean>(false);

  // Loader step animation loop
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setLoadingStep((prev) => (prev < LOADER_STEPS.length - 1 ? prev + 1 : prev));
      setLoadingProgress((prev) => Math.min(prev + 20, 95));
    }, 450);
    return () => clearInterval(interval);
  }, [loading]);

  // Generate or re-hydrate spec graph on mount with persisted user answers
  useEffect(() => {
    const activeBrief = brief.trim() || 'arduino uno + led + external website status + button';
    if (!brief.trim()) setBrief(activeBrief);

    async function initSpecGraph() {
      setLoading(true);
      setError(null);
      try {
        const mergedAnswers = { ...answers, ...selectedAnswerMap };
        let res;
        if (storeSpecGraph) {
          res = await api.answerSpecGraph({
            specGraph: storeSpecGraph,
            answers: mergedAnswers,
          });
        } else {
          res = await api.generateSpecGraph({ prompt: activeBrief, answers: mergedAnswers });
        }

        setSpecGraph(res.specGraph);
        setStoreSpecGraph(res.specGraph);
        setArchGraph(res.archGraph);
        setIsReady(res.isReady);
        if (res.archGraph) {
          setGraph(res.archGraph);
        }
        setLoadingProgress(100);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate Spec Graph document.');
      } finally {
        setTimeout(() => setLoading(false), 300);
      }
    }
    void initSpecGraph();
  }, []);

  const handleAnswerSubmit = async (questionId: string, answerValue: string) => {
    const activeGraph = specGraph || storeSpecGraph;
    if (!activeGraph) return;
    setAnswering(true);
    try {
      // Persist answer in useDesignSession store
      setAnswer(questionId, answerValue);

      const answersMap = { ...answers, ...selectedAnswerMap, [questionId]: answerValue };
      setSelectedAnswerMap(answersMap);

      const res = await api.answerSpecGraph({
        specGraph: activeGraph,
        answers: answersMap,
      });

      setSpecGraph(res.specGraph);
      setStoreSpecGraph(res.specGraph);
      setArchGraph(res.archGraph);
      setIsReady(res.isReady);
      if (res.archGraph) {
        setGraph(res.archGraph);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit answer to Spec Graph.');
    } finally {
      setAnswering(false);
    }
  };

  const currentQuestion = specGraph?.question_queue?.[0];

  return (
    <div className="page spec-graph-page" style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Header */}
      <header className="spec-graph-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="eyebrow" style={{ color: '#888', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Hardware Project Spec Graph · Live Document
          </div>
          <h1 style={{ margin: '8px 0', fontSize: '2rem', fontWeight: 700 }}>
            {specGraph?.project?.title || 'Generating Hardware Spec Graph…'}
          </h1>
          <p className="muted" style={{ color: '#aaa', margin: 0 }}>
            Raw Brief: &quot;{specGraph?.project?.raw_prompt || brief}&quot;
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span
            className="status-pill"
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              fontWeight: 600,
              fontSize: '0.85rem',
              backgroundColor: isReady ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
              color: isReady ? '#4ade80' : '#fde047',
              border: `1px solid ${isReady ? '#22c55e' : '#eab308'}`,
            }}
          >
            {isReady ? '✔ Ready for Build' : '⚡ Awaiting User Resolution'}
          </span>
          <button
            type="button"
            className="primary-button"
            disabled={!isReady}
            onClick={() => navigate('/graph')}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: isReady ? 'pointer' : 'not-allowed',
              opacity: isReady ? 1 : 0.5,
            }}
          >
            Proceed to 2D/3D Canvas →
          </button>
        </div>
      </header>

      {error && (
        <div className="inline-error" style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#f87171', borderRadius: '8px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {/* ??$$$ Glassmorphic AI Pipeline Loader between Prompt Page and Ideation Page */}
      {loading ? (
        <div
          className="ai-loader-container"
          style={{
            minHeight: '480px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.8))',
            borderRadius: '16px',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), inset 0 0 15px rgba(59, 130, 246, 0.1)',
            backdropFilter: 'blur(12px)',
            padding: '40px',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: '520px', width: '100%' }}>
            {/* Pulsing Wireup Icon */}
            <div
              style={{
                width: '72px',
                height: '72px',
                margin: '0 auto 24px auto',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '2.2rem',
                boxShadow: '0 0 25px rgba(59, 130, 246, 0.6)',
                animation: 'pulse 1.5s infinite alternate',
              }}
            >
              ⚡
            </div>

            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
              Decomposing Hardware Brief
            </h2>
            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '28px' }}>
              Decomposition engine generating per-domain spec nodes & Ask/Decide gate evaluation
            </p>

            {/* Glowing Animated Progress Bar */}
            <div
              style={{
                width: '100%',
                height: '8px',
                background: '#0f172a',
                borderRadius: '4px',
                overflow: 'hidden',
                marginBottom: '24px',
                border: '1px solid #1e293b',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${loadingProgress}%`,
                  background: 'linear-gradient(90deg, #3b82f6, #6366f1, #a855f7)',
                  borderRadius: '4px',
                  transition: 'width 0.4s ease-out',
                  boxShadow: '0 0 12px rgba(99, 102, 241, 0.8)',
                }}
              />
            </div>

            {/* Live Step Sequence List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
              {LOADER_STEPS.map((stepText, idx) => {
                const isActive = idx === loadingStep;
                const isDone = idx < loadingStep;
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      fontSize: '0.85rem',
                      color: isActive ? '#60a5fa' : isDone ? '#4ade80' : '#475569',
                      fontWeight: isActive ? 600 : 400,
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <span>{isDone ? '✔' : isActive ? '⚡' : '○'}</span>
                    <span>{stepText}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="spec-graph-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          {/* Left Column: Spec Document Tree */}
          <div className="spec-document-card" style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '16px', borderBottom: '1px solid #1f2937', paddingBottom: '10px' }}>
              📁 Project Manifest & Branch Nodes
            </h2>

            {/* Branches List */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '0.85rem', color: '#888', marginBottom: '8px' }}>BRANCHES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {specGraph?.branches?.map((b: any) => (
                  <div
                    key={b.id}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      background: '#1f2937',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>{b.domain}</span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background:
                          b.status === 'validated'
                            ? '#064e3b'
                            : b.status === 'user_confirmed'
                            ? '#1e3a8a'
                            : b.status === 'assumed'
                            ? '#374151'
                            : '#78350f',
                        color:
                          b.status === 'validated'
                            ? '#34d399'
                            : b.status === 'user_confirmed'
                            ? '#60a5fa'
                            : b.status === 'assumed'
                            ? '#9ca3af'
                            : '#fbbf24',
                      }}
                    >
                      {b.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed Nodes List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '500px', overflowY: 'auto', paddingRight: '6px' }}>
              {Object.values(specGraph?.nodes || {}).map((node: any) => (
                <div
                  key={node.id}
                  style={{
                    background: '#1a2234',
                    border: '1px solid #2d3748',
                    borderRadius: '8px',
                    padding: '14px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong style={{ color: '#60a5fa' }}>{node.title}</strong>
                    <span style={{ fontSize: '0.75rem', color: '#a0aec0', background: '#2d3748', padding: '2px 6px', borderRadius: '4px' }}>
                      {node.domain}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.8rem', color: '#cbd5e0', marginBottom: '8px' }}>
                    <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px' }}>
                      {JSON.stringify(node.spec)}
                    </code>
                  </div>

                  {node.requires?.length > 0 && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      ⬅ Requires: {node.requires.join(', ')}
                    </div>
                  )}
                  {node.produces?.length > 0 && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      ➡ Produces: {node.produces.join(', ')}
                    </div>
                  )}

                  {node.assumptions?.length > 0 && (
                    <div style={{ marginTop: '6px', fontSize: '0.75rem', color: '#fbbf24' }}>
                      💡 Assumptions: {node.assumptions.map((a: any) => `${a.claim} (${a.why})`).join('; ')}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Assumption Log Audit */}
            {specGraph?.assumption_log?.length > 0 && (
              <div style={{ marginTop: '20px', paddingTop: '14px', borderTop: '1px solid #1f2937' }}>
                <h3 style={{ fontSize: '0.95rem', color: '#fbbf24', marginBottom: '8px' }}>
                  📜 Audit Log of Assumptions
                </h3>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.8rem', color: '#9ca3af' }}>
                  {specGraph.assumption_log.map((a: any, idx: number) => (
                    <li key={idx} style={{ marginBottom: '4px' }}>
                      <strong>[{a.node_id}]</strong> {a.claim} — <span style={{ fontStyle: 'italic' }}>{a.why}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right Column: Live Architecture Graph Twin */}
          <div className="spec-graph-canvas-card" style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '16px', borderBottom: '1px solid #1f2937', paddingBottom: '10px' }}>
              🌐 Live 2D Architecture Twin
            </h2>
            <div style={{ flex: 1, minHeight: '450px', background: '#0b0f19', borderRadius: '8px', border: '1px solid #1e293b', overflow: 'hidden' }}>
              {archGraph ? (
                <GraphCanvas />
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                  Architecture Graph twin initializing…
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Ask/Decide Gate AI Doubt Modal ────────────────────────────────────── */}
      {!loading && currentQuestion && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            className="modal-card"
            style={{
              background: '#1e293b',
              border: '1px solid #3b82f6',
              borderRadius: '16px',
              padding: '28px',
              maxWidth: '560px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '1.2rem' }}>🤔</span>
              <div style={{ color: '#60a5fa', textTransform: 'uppercase', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '1px' }}>
                Hardware Spec Gate · Unresolved Requirement
              </div>
            </div>

            <h3 style={{ fontSize: '1.2rem', color: '#f8fafc', margin: '0 0 8px 0' }}>
              {currentQuestion.q}
            </h3>

            {currentQuestion.why_blocking && (
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', background: '#0f172a', padding: '10px 14px', borderRadius: '8px', borderLeft: '3px solid #ef4444', marginBottom: '20px' }}>
                <strong>Why blocking:</strong> {currentQuestion.why_blocking}
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              {currentQuestion.options?.map((opt: string) => (
                <button
                  key={opt}
                  type="button"
                  disabled={answering}
                  onClick={() => void handleAnswerSubmit(currentQuestion.id || currentQuestion.q, opt)}
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.borderColor = '#3b82f6')}
                  onMouseOut={(e) => (e.currentTarget.style.borderColor = '#334155')}
                >
                  👉 {opt}
                </button>
              ))}
            </div>

            <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center' }}>
              The AI will re-evaluate dirty propagation and graph consistency after your selection.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
