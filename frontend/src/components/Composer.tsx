import { useDesignSession } from '../store/useDesignSession';
import { LayersIcon } from './Icons';

const SUGGESTIONS = [
  'Add a low-power solar charging option',
  'Show the firmware and data flow',
  'Audit power and sleep states',
];

export default function Composer() {
  const brief = useDesignSession((state) => state.brief);
  const stage = useDesignSession((state) => state.stage);
  const setBrief = useDesignSession((state) => state.setBrief);
  const startInterpretation = useDesignSession((state) => state.startInterpretation);
  const runPlan = useDesignSession((state) => state.runPlan);

  const isBusy = stage === 'interpreting' || stage === 'planning';
  const hasDraft = stage === 'reviewing' || stage === 'accepted';

  const label =
    stage === 'interpreting'
      ? 'Working out what I can decide…'
      : stage === 'planning'
        ? 'Building the architecture…'
        : hasDraft
          ? 'Regenerate'
          : 'Start';

  const handleClick = () => {
    if (hasDraft) void runPlan();
    else void startInterpretation();
  };

  return (
    <section className="composer" aria-labelledby="composer-title">
      <div className="composer-top">
        <div className="composer-label" id="composer-title">
          <span className="spark">
            <LayersIcon />
          </span>
          Describe the hardware you want to build
        </div>
        <span className="composer-hint">I&apos;ll decide what I can, and only ask about the rest</span>
      </div>

      <textarea
        id="request-input"
        data-testid="input-architecture-request"
        aria-label="Describe your hardware project"
        value={brief}
        placeholder="Describe the product, constraints, interfaces, and operating environment…"
        onChange={(event) => setBrief(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            handleClick();
          }
        }}
      />

      <div className="composer-bottom">
        <div className="suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="suggestion"
              onClick={() => setBrief(`${brief.trim()} ${suggestion}.`.trim())}
            >
              {suggestion}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="plan-button"
          id="plan-button"
          data-testid="button-generate-plan"
          disabled={isBusy}
          onClick={handleClick}
        >
          <span className="button-label">{label}</span>
          <span className="button-arrow">↗</span>
        </button>
      </div>
    </section>
  );
}