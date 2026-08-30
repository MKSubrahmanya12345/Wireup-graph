import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useDesignSession } from '../store/useDesignSession';
import { useGraphStore } from '../store/useGraphStore';
import type { Question } from '../types/session';
import type { LlmProvider } from '../types/llm';

const SUGGESTIONS = [
  'a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer',
  'esp32 with a soil moisture sensor and a relay to water my plant when dry — dashboard on my pc',
  'esp32 + bme280 weather station logging to a website i can open at home',
  'esp32 cam-free security: pir motion sensor + buzzer + led, web dashboard on my laptop',
];

const LLM_PROVIDER_OPTIONS: { value: LlmProvider; label: string; models: string[] }[] = [
  { value: 'groq', label: 'Groq', models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768'] },
  { value: 'bedrock', label: 'AWS Bedrock', models: ['moonshotai.kimi-k2.5', 'minimax.minimax-m2.5', 'amazon.nova-pro-v1:0', 'anthropic.claude-3-sonnet-20240229-v1:0'] },
];

/**
 * Page 01 — Prompt & questions.
 * Tell Wireup what you own and what you want; the engine decides what it can
 * and asks only what's left.
 */
export default function IntakePage() {
  const navigate = useNavigate();
  const stage = useDesignSession((state) => state.stage);
  const brief = useDesignSession((state) => state.brief);
  const setBrief = useDesignSession((state) => state.setBrief);
  const questions = useDesignSession((state) => state.questions);
  const answers = useDesignSession((state) => state.answers);
  const setAnswer = useDesignSession((state) => state.setAnswer);
  const requirements = useDesignSession((state) => state.requirements);
  const assumptions = useDesignSession((state) => state.assumptions);
  const error = useDesignSession((state) => state.error);
  const startInterpretation = useDesignSession((state) => state.startInterpretation);
  const submitAnswers = useDesignSession((state) => state.submitAnswers);
  const skipQuestions = useDesignSession((state) => state.skipQuestions);
  const revision = useDesignSession((state) => state.revision);
  const setLlmOptions = useDesignSession((state) => state.setLlmOptions);
  const nodeCount = useGraphStore((state) => state.graph.nodes.length);

  const busy = stage === 'interpreting' || stage === 'planning';

  // LLM provider/model selection
  const [provider, setProvider] = useState<LlmProvider>('groq');
  const [model, setModel] = useState<string>(LLM_PROVIDER_OPTIONS[0].models[0]);

  // Planned → land on the graph page.
  useEffect(() => {
    if (stage === 'reviewing' && nodeCount > 0) navigate('/graph');
  }, [stage, nodeCount, navigate]);

  const handleProviderChange = (newProvider: LlmProvider) => {
    setProvider(newProvider);
    const models = LLM_PROVIDER_OPTIONS.find((p) => p.value === newProvider)?.models ?? [];
    setModel(models[0] ?? '');
  };

  return (
    <div className="page intake-page">
      <section className="intake-hero">
        <div className="eyebrow">Wireup pipeline · 01 — prompt & questions</div>
        <h1>
          What are we <span className="accent-text">wiring up</span>?
        </h1>
        <p className="muted">
          Name the parts on your bench and what you want them to do. Wireup checks its
          device knowledge base, asks only what it genuinely can't decide, then takes
          you to the graph.
        </p>
      </section>

      <section className="composer-card">
        <textarea
          className="brief-input"
          rows={5}
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="e.g. a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer"
          disabled={busy}
        />
        
        {/* LLM Provider Selector */}
        <div className="llm-selector-row">
          <div className="llm-field">
            <label htmlFor="provider">AI Provider</label>
            <select
              id="provider"
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as LlmProvider)}
              disabled={busy}
            >
              {LLM_PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="llm-field">
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={busy}
            >
              {LLM_PROVIDER_OPTIONS.find((p) => p.value === provider)?.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="composer-foot">
          <div className="suggestion-row">
            {SUGGESTIONS.map((suggestion, i) => (
              <button
                key={suggestion}
                type="button"
                className="suggestion-chip"
                title={suggestion}
                onClick={() => setBrief(suggestion)}
                disabled={busy}
              >
                {i === 0 ? '⭐ ' : ''}
                {suggestion.length > 64 ? `${suggestion.slice(0, 64)}…` : suggestion}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={!brief.trim() || busy}
            onClick={() => {
                          console.log('[IntakePage] Generate button clicked');
                          console.log('[IntakePage] Brief:', brief.trim());
                          console.log('[IntakePage] Provider:', provider);
                          console.log('[IntakePage] Model:', model);
                          console.log('[IntakePage] Current stage:', stage);
                          console.log('[IntakePage] Setting LLM options...');
                          setLlmOptions({ provider, model });
                          console.log('[IntakePage] Calling startInterpretation...');
                          void startInterpretation({ provider, model });
                          console.log('[IntakePage] startInterpretation called');
                        }}
          >
            {stage === 'interpreting'
              ? 'Reading the brief…'
              : stage === 'planning'
                ? 'Building the plan…'
                : revision > 0
                  ? 'Re-analyze →'
                  : 'Analyze my build →'}
          </button>
        </div>
        {error && <div className="inline-error">{error}</div>}
      </section>

      {stage === 'questioning' && questions.length > 0 && (
        <section className="questions-card">
          <div className="card-head">
            <div>
              <div className="eyebrow">agent questions</div>
              <h2>Only what it can't decide</h2>
              <p className="muted">
                Everything else was decided from the knowledge base. Defaults are pre-filled —
                change what matters, skip the rest.
              </p>
            </div>
          </div>

          <div className="question-list">
            {questions.map((question) => (
              <QuestionCard
                key={question.id}
                question={question}
                value={answers[question.id] ?? question.default}
                onChange={(value) => setAnswer(question.id, value)}
              />
            ))}
          </div>

          <div className="question-actions">
            <button type="button" className="primary-button" onClick={() => void submitAnswers()}>
              Generate with my answers →
            </button>
            <button type="button" className="ghost-button" onClick={() => void skipQuestions()}>
              Skip — use the defaults
            </button>
          </div>
        </section>
      )}

      {requirements && (
        <section className="rag-card">
          <div className="eyebrow">engine read-out</div>
          <div className="rag-grid">
            <div className="rag-fact">
              <span>Project</span>
              <strong>{requirements.project}</strong>
            </div>
            <div className="rag-fact">
              <span>Domain</span>
              <strong>{requirements.domain}</strong>
            </div>
            <div className="rag-fact">
              <span>Board</span>
              <strong>{String(requirements.constraints.board ?? 'esp32-devkit')}</strong>
            </div>
            <div className="rag-fact">
              <span>Web dashboard</span>
              <strong>{requirements.constraints.web ? 'yes' : 'no'}</strong>
            </div>
          </div>
          <p className="intent-line">{requirements.intent}</p>
          {assumptions.length > 0 && (
            <ul className="assumption-list">
              {assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function QuestionCard({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="question-card">
      <div className="question-head">
        <strong>{question.prompt}</strong>
        {question.unit && <span className="unit-badge">{question.unit}</span>}
      </div>
      {question.why && <p className="question-why">Why I'm asking: {question.why}</p>}
      {question.impact && <p className="question-impact">This changes: {question.impact}</p>}

      {question.kind === 'single' && (
        <div className="option-grid">
          {question.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`option-card${value === option.value ? ' selected' : ''}`}
              onClick={() => onChange(option.value)}
            >
              <strong>{option.label}</strong>
              {option.hint && <span>{option.hint}</span>}
            </button>
          ))}
        </div>
      )}

      {question.kind === 'number' && (
        <label className="field number-field">
          <input
            type="number"
            value={value}
            min={question.min}
            max={question.max}
            onChange={(event) => onChange(event.target.value)}
          />
          {question.unit && <span className="unit-badge">{question.unit}</span>}
        </label>
      )}

      {question.kind === 'boolean' && (
        <div className="option-grid two">
          {['yes', 'no'].map((option) => (
            <button
              key={option}
              type="button"
              className={`option-card${value === option ? ' selected' : ''}`}
              onClick={() => onChange(option)}
            >
              <strong>{option === 'yes' ? 'Yes' : 'No'}</strong>
            </button>
          ))}
        </div>
      )}

      {question.kind === 'multi' && (
        <div className="option-grid">
          {question.options.map((option) => {
            const selected = value.split(',').map((v) => v.trim()).includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`option-card${selected ? ' selected' : ''}`}
                onClick={() => {
                  const current = new Set(value.split(',').map((v) => v.trim()).filter(Boolean));
                  if (selected) current.delete(option.value);
                  else current.add(option.value);
                  onChange([...current].join(', '));
                }}
              >
                <strong>{option.label}</strong>
                {option.hint && <span>{option.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
