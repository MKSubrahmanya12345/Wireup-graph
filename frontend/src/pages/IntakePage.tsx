import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useDesignSession } from '../store/useDesignSession';

const SUGGESTIONS = [
  'a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer',
  'esp32 with a soil moisture sensor and a relay to water my plant when dry — dashboard on my pc',
  'esp32 + bme280 weather station logging to a website i can open at home',
  'esp32 cam-free security: pir motion sensor + buzzer + led, web dashboard on my laptop',
  'arduino uno + led + external website status + button',
];

const BEDROCK_MODELS = [
  'moonshotai.kimi-k2.5',
  'minimax.minimax-m2.5',
  'amazon.nova-pro-v1:0',
  'anthropic.claude-3-sonnet-20240229-v1:0',
];

/**
 * Page 01 — Prompt & questions.
 *
 * The prompt composer is the whole page: the user writes an engineering brief,
 * picks an LLM, and hands off to the AI-powered Spec Graph (page 01b).
 * Everything the old page did after "Analyze" — questions, engine read-out,
 * the 3D bench, the validity gate — now lives on the Spec Graph page.
 */
export default function IntakePage() {
  const navigate = useNavigate();

  const brief = useDesignSession((state) => state.brief);
  const setBrief = useDesignSession((state) => state.setBrief);
  const setLlmOptions = useDesignSession((state) => state.setLlmOptions);
  const clearAutoStart = useDesignSession((state) => state.clearAutoStart);

  const [model, setModel] = useState<string>(BEDROCK_MODELS[0]);

  // The homepage prompt box pre-fills the brief and sets an auto-start flag for
  // the OLD flow. Here the composer is the flow — clear the stale flag once.
  useEffect(() => {
    clearAutoStart();
  }, [clearAutoStart]);

  const analyze = () => {
    if (!brief.trim()) return;
    setLlmOptions({ provider: 'bedrock', model });
    navigate('/spec-graph');
  };

  return (
    <div className="page intake-page">
      <section className="intake-hero">
        <div className="eyebrow">Wireup pipeline · 01 — prompt &amp; questions</div>
        <h1>
          What are we <span className="accent-text">wiring up</span>?
        </h1>
        <p className="muted">
          Name the parts on your bench and what you want them to do. Wireup reads your brief,
          decomposes it into a hardware spec graph, and asks only what it genuinely can’t decide.
        </p>
      </section>

      <section className="composer-card intake-composer">
        <textarea
          className="brief-input"
          rows={7}
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="e.g. a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer"
          autoFocus
        />

        <div className="composer-suggestions" role="list" aria-label="Example briefs">
          {SUGGESTIONS.map((suggestion, i) => (
            <button
              key={suggestion}
              type="button"
              className="suggestion-chip"
              title={suggestion}
              onClick={() => setBrief(suggestion)}
            >
              {i === 0 ? '⭐ ' : ''}
              {suggestion}
            </button>
          ))}
        </div>

        <div className="composer-foot">
          <label className="llm-selector compact" htmlFor="model">
            <span className="llm-selector-label">Model · AWS Bedrock</span>
            <select
              id="model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              {BEDROCK_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="primary-button"
            disabled={!brief.trim()}
            onClick={analyze}
          >
            Analyze my build →
          </button>
        </div>
      </section>

      <p className="tiny muted intake-note">
        Analysis runs the AI decomposition engine — your brief becomes a dependency graph of
        hardware, power, software and connectivity nodes before any code exists.
      </p>
    </div>
  );
}
