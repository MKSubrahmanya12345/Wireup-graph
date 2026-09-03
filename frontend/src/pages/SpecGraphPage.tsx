// Hardware Project Spec Graph — live document + architecture twin + Ask/Decide gate.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import SpecGraphCanvas from '../components/SpecGraphCanvas';
import { layoutSpecGraph } from '../lib/specGraphLayout';
import { statusMeta } from '../lib/specGraphStatus';
import { api } from '../services/api';
import { useDesignSession } from '../store/useDesignSession';
import { useGraphStore } from '../store/useGraphStore';
import type { ArchitectureGraph } from '../types/architecture';
import type {
  SpecGraphProject,
  SpecGraphResponse,
  SpecNode,
  SpecQuestion,
} from '../types/specGraph';

const LOADER_STEPS = [
  'Reading brief & extracting explicit requirements…',
  'Inferring implicit capabilities & capability gaps…',
  'Evaluating the 3-part Ask/Decide gate…',
  'Spawning nodes, dependency & lineage edges…',
  'Running cross-node consistency + resource validation…',
  'Synthesizing the 2D architecture twin…',
];

const STARTER_BRIEF = 'arduino uno + led + external website status + button';

function questionKey(question: SpecQuestion): string {
  return question.id || question.q;
}

function effectiveAnswer(question: SpecQuestion, answers: Record<string, string>): string {
  return answers[questionKey(question)] ?? question.default ?? question.options?.[0] ?? '';
}

export default function SpecGraphPage() {
  const navigate = useNavigate();

  const brief = useDesignSession((state) => state.brief);
  const setBrief = useDesignSession((state) => state.setBrief);
  const answers = useDesignSession((state) => state.answers);
  const setAnswer = useDesignSession((state) => state.setAnswer);
  const storeSpecGraph = useDesignSession((state) => state.specGraph);
  const setStoreSpecGraph = useDesignSession((state) => state.setSpecGraph);
  const llmOptions = useDesignSession((state) => state.llmOptions);
  const setGraph = useGraphStore((state) => state.setGraph);

  const [loading, setLoading] = useState<boolean>(true);
  const [loadingStep, setLoadingStep] = useState<number>(0);
  const [loadingProgress, setLoadingProgress] = useState<number>(12);
  const [error, setError] = useState<string | null>(null);

  const [specGraph, setSpecGraph] = useState<SpecGraphProject | null>(storeSpecGraph);
  const [archGraph, setArchGraph] = useState<ArchitectureGraph | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>(answers ?? {});
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Loader step animation.
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setLoadingStep((prev) => Math.min(prev + 1, LOADER_STEPS.length - 1));
      setLoadingProgress((prev) => Math.min(prev + 17, 96));
    }, 520);
    return () => clearInterval(interval);
  }, [loading]);

  // Generate (fresh brief) or re-hydrate (same brief in store) on mount.
  useEffect(() => {
    const activeBrief = brief.trim() || STARTER_BRIEF;
    if (!brief.trim()) setBrief(activeBrief);

    let cancelled = false;

    async function initSpecGraph() {
      setLoading(true);
      setError(null);
      try {
        let res: SpecGraphResponse;
        if (storeSpecGraph && storeSpecGraph.raw_prompt === activeBrief) {
          // Already decomposed this brief — just re-apply answers (no LLM spend).
          res = await api.answerSpecGraph({ specGraph: storeSpecGraph, answers: answers ?? {} });
        } else {
          res = await api.generateSpecGraph({
            prompt: activeBrief,
            answers: answers ?? {},
            provider: llmOptions.provider,
            model: llmOptions.model,
          });
        }
        if (cancelled) return;

        setSpecGraph(res.specGraph);
        setStoreSpecGraph(res.specGraph);
        setArchGraph(res.archGraph);
        setIsReady(res.isReady);
        const firstId = Object.keys(res.specGraph.nodes)[0];
        setSelectedId(firstId ?? null);

        // Pre-select the recommended default for every open question.
        const defaults: Record<string, string> = { ...(answers ?? {}) };
        for (const question of res.specGraph.question_queue) {
          defaults[questionKey(question)] =
            answers?.[questionKey(question)] ??
            question.default ??
            question.options?.[0] ??
            '';
        }
        setSelectedAnswers(defaults);
        setLoadingProgress(100);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to generate the Spec Graph.');
        }
      } finally {
        setTimeout(() => {
          if (!cancelled) setLoading(false);
        }, 320);
      }
    }

    void initSpecGraph();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orderedNodes = useMemo<SpecNode[]>(() => {
    if (!specGraph) return [];
    const positions = layoutSpecGraph(specGraph);
    return Object.values(specGraph.nodes).sort((a, b) => {
      const pa = positions[a.id] ?? { x: 0, y: 0 };
      const pb = positions[b.id] ?? { x: 0, y: 0 };
      return pa.x - pb.x || pa.y - pb.y;
    });
  }, [specGraph]);

  const questions = specGraph?.question_queue ?? [];
  const allAnswered =
    questions.length > 0 && questions.every((q) => effectiveAnswer(q, selectedAnswers));

  const applyAnswers = async () => {
    if (!specGraph || !allAnswered) return;
    setSubmitting(true);
    setError(null);
    try {
      const merged = { ...answers, ...selectedAnswers };
      const res = await api.answerSpecGraph({ specGraph, answers: merged });

      for (const question of questions) {
        const value = effectiveAnswer(question, selectedAnswers);
        if (value) setAnswer(questionKey(question), value);
      }

      setSpecGraph(res.specGraph);
      setStoreSpecGraph(res.specGraph);
      setArchGraph(res.archGraph);
      setIsReady(res.isReady);
      setSelectedAnswers({ ...merged, ...selectedAnswers });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply those answers.');
    } finally {
      setSubmitting(false);
    }
  };

  const proceed = () => {
    if (!isReady || !archGraph) return;
    setGraph(archGraph);
    navigate('/graph');
  };

  const edgeCount =
    Object.values(specGraph?.nodes ?? {}).reduce(
      (sum, node) => sum + node.requires.length + node.spawned.length,
      0,
    ) ?? 0;

  return (
    <div className="page spec-graph-page">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sg-header">
        <div className="sg-header-main">
          <div className="eyebrow">Hardware Project Spec Graph · Live Document</div>
          <h1>{specGraph?.title ?? 'Generating Hardware Spec Graph…'}</h1>
          <p className="sg-raw-brief">
            Raw Brief: <span>“{specGraph?.raw_prompt || brief}”</span>
          </p>
          <p className="sg-stats">
            {Object.keys(specGraph?.nodes ?? {}).length} nodes · {edgeCount} edges ·{' '}
            <code>{specGraph?.domain ?? '…'}</code>
          </p>
        </div>

        <div className="sg-header-actions">
          <span className={`sg-status-pill ${isReady ? 'ready' : 'awaiting'}`}>
            {isReady ? '✔ Ready for Build' : '⚡ Awaiting User Resolution'}
          </span>
          <button
            type="button"
            className="primary-button"
            disabled={!isReady}
            title={isReady ? 'Continue to the 2D/3D canvas' : 'Resolve the open requirements first'}
            onClick={proceed}
          >
            Proceed to 2D/3D Canvas →
          </button>
        </div>
      </header>

      {error && <div className="inline-error">{error}</div>}

      {/* ── Loader ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="sg-loader">
          <div className="sg-loader-mark">⚡</div>
          <h2>Decomposing Hardware Brief</h2>
          <p>AI decomposition pass — spec nodes, dependency edges &amp; the Ask/Decide gate.</p>
          <div className="sg-loader-bar">
            <div style={{ width: `${loadingProgress}%` }} />
          </div>
          <div className="sg-loader-steps">
            {LOADER_STEPS.map((step, index) => {
              const done = index < loadingStep;
              const active = index === loadingStep;
              return (
                <div key={step} className={`sg-loader-step ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
                  <span>{done ? '✔' : active ? '⚡' : '○'}</span>
                  <span>{step}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="sg-grid">
          {/* ── Left: spec document tree ─────────────────────────────────── */}
          <aside className="sg-doc">
            <div className="sg-doc-head">
              <div>
                <div className="eyebrow">Project Manifest</div>
                <h2>Branch Nodes</h2>
              </div>
              <span className="panel-mono">{Object.keys(specGraph?.nodes ?? {}).length} nodes</span>
            </div>

            <div className="sg-branches">
              <div className="sg-section-label">Branches</div>
              <div className="sg-branch-list">
                {(specGraph?.branches ?? []).map((branch) => {
                  const meta = statusMeta(branch.status);
                  return (
                    <span key={branch.id} className="sg-branch-pill" style={{ color: meta.color, background: meta.fill, borderColor: `${meta.color}55` }}>
                      <span className="sg-branch-domain">{branch.domain}</span>
                      <span className="sg-branch-status">{meta.label}</span>
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="sg-section-label">Spec nodes</div>
            <div className="sg-node-list">
              {orderedNodes.map((node) => {
                const meta = statusMeta(node.status);
                const selected = node.id === selectedId;
                const specEntries = Object.entries(node.spec ?? {});
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={`sg-node-card${selected ? ' selected' : ''}`}
                    style={selected ? { borderColor: meta.color } : undefined}
                    onClick={() => setSelectedId(node.id)}
                  >
                    <div className="sg-node-card-head">
                      <strong className="sg-node-title">{node.title}</strong>
                      <span className="sg-node-status" style={{ color: meta.color, background: meta.fill }}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="sg-node-domain">{node.domain}</div>

                    {specEntries.length > 0 && (
                      <dl className="sg-node-spec">
                        {specEntries.slice(0, 4).map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>
                              <code>
                                {typeof value === 'object' && value !== null
                                  ? JSON.stringify(value)
                                  : String(value)}
                              </code>
                            </dd>
                          </div>
                        ))}
                        {specEntries.length > 4 && <div className="muted tiny">+{specEntries.length - 4} more</div>}
                      </dl>
                    )}

                    <div className="sg-node-edges">
                      {node.requires.length > 0 && (
                        <div className="sg-edge-row">
                          <span className="sg-edge-key requires">requires</span>
                          {node.requires.map((id) => (
                            <span
                              key={id}
                              className="sg-edge-chip"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedId(id);
                              }}
                            >
                              {specGraph?.nodes[id]?.title ?? id}
                            </span>
                          ))}
                        </div>
                      )}
                      {node.spawned.length > 0 && (
                        <div className="sg-edge-row">
                          <span className="sg-edge-key spawned">spawned</span>
                          {node.spawned.map((id) => (
                            <span
                              key={id}
                              className="sg-edge-chip spawned"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedId(id);
                              }}
                            >
                              {specGraph?.nodes[id]?.title ?? id}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {node.assumptions.length > 0 && (
                      <ul className="sg-node-assumptions">
                        {node.assumptions.slice(0, 2).map((assumption, index) => (
                          <li key={index}>
                            <strong>{assumption.claim}</strong>
                            <span>{assumption.why}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {node.known_uncertainty.length > 0 && (
                      <div className="sg-node-uncertainty">
                        {node.known_uncertainty.map((uncertainty) => (
                          <span key={uncertainty}>± {uncertainty}</span>
                        ))}
                      </div>
                    )}

                    {node.open_questions.length > 0 && (
                      <div className="sg-node-pending">⚡ {node.open_questions.length} open question(s)</div>
                    )}
                  </button>
                );
              })}
            </div>

            {(specGraph?.assumption_log?.length ?? 0) > 0 && (
              <div className="sg-audit">
                <div className="sg-section-label">Audit log of assumptions</div>
                <ul>
                  {(specGraph?.assumption_log ?? []).map((entry, index) => (
                    <li key={index}>
                      <code>[{entry.node_id}]</code>
                      <span>{entry.claim} — {entry.why}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>

          {/* ── Right: live architecture twin ─────────────────────────────── */}
          <section className="sg-stage">
            {specGraph ? (
              <SpecGraphCanvas specGraph={specGraph} selectedId={selectedId} onSelect={setSelectedId} />
            ) : (
              <div className="sg-stage-empty">Architecture twin initializing…</div>
            )}
          </section>
        </div>
      )}

      {/* ── Ask/Decide Gate modal (batched) ───────────────────────────────── */}
      {!loading && specGraph && questions.length > 0 && (
        <div className="sg-modal-overlay">
          <div className="sg-modal">
            <div className="sg-modal-head">
              <div className="sg-modal-eyebrow">Hardware Spec Gate · Unresolved Requirement{questions.length > 1 ? 's' : ''}</div>
              <div className="sg-modal-count">
                <strong>{questions.length}</strong> unresolved requirement{questions.length > 1 ? 's' : ''}
                <span>· blocks final graph</span>
              </div>
            </div>

            <p className="sg-modal-intro">
              Wireup has already decided everything it safely can. {questions.length > 1
                ? 'These are the only decisions that genuinely require your input.'
                : 'This is the one decision that genuinely requires your input.'}
            </p>

            <div className="sg-modal-questions">
              {questions.map((question, questionIndex) => {
                const selected = effectiveAnswer(question, selectedAnswers);
                return (
                  <div key={questionKey(question)} className="sg-question">
                    <div className="sg-question-head">
                      <span className="sg-question-index">{questionIndex + 1}</span>
                      <h3>{question.q}</h3>
                    </div>
                    {question.why_blocking && (
                      <p className="sg-question-why">
                        <strong>Why blocking:</strong> {question.why_blocking}
                      </p>
                    )}
                    <div className="sg-option-grid">
                      {(question.options ?? []).map((option) => {
                        const isSelected = selected === option;
                        return (
                          <button
                            key={option}
                            type="button"
                            className={`sg-option-card${isSelected ? ' selected' : ''}`}
                            onClick={() =>
                              setSelectedAnswers((prev) => ({
                                ...prev,
                                [questionKey(question)]: option,
                              }))
                            }
                          >
                            <span className="sg-option-radio">{isSelected ? '●' : '○'}</span>
                            <span>{option}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="sg-modal-foot">
              <span className="tiny muted">
                Your selection re-runs dirty propagation and re-validates the graph.
              </span>
              <button
                type="button"
                className="primary-button"
                disabled={!allAnswered || submitting}
                onClick={() => void applyAnswers()}
              >
                {submitting ? 'Applying…' : questions.length > 1 ? 'Apply answers →' : 'Resolve →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
