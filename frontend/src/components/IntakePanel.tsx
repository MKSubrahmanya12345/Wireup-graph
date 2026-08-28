import { useDesignSession } from '../store/useDesignSession';
import type { Question } from '../types/session';

/**
 * The questionnaire. Every question carries the AI's recommended default and
 * is pre-filled with it, so the human's default path is one click.
 *
 * Each question also shows WHY the AI could not decide it — if the AI asks
 * something it should have known, that is visible and therefore fixable.
 */
export default function IntakePanel() {
  const questions = useDesignSession((state) => state.questions);
  const answers = useDesignSession((state) => state.answers);
  const requirements = useDesignSession((state) => state.requirements);
  const assumptions = useDesignSession((state) => state.assumptions);
  const setAnswer = useDesignSession((state) => state.setAnswer);
  const submitAnswers = useDesignSession((state) => state.submitAnswers);
  const skipQuestions = useDesignSession((state) => state.skipQuestions);

  if (questions.length === 0) return null;

  return (
    <section className="intake-panel">
      <header className="panel-bar">
        <div className="panel-title">
          <span className="bar-mark" style={{ background: 'var(--coral)' }} />
          Before I build
        </div>
        <span className="panel-mono">{questions.length} QUESTION(S)</span>
      </header>

      <div className="intake-body">
        {requirements?.intent && (
          <div className="intent-block">
            <div className="section-label">What I think you want</div>
            <p>{requirements.intent}</p>
          </div>
        )}

        {assumptions.length > 0 && (
          <div className="assumption-block">
            <div className="section-label">What I decided myself</div>
            <ul className="detail-bullets">
              {assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
        )}

        {questions.map((question) => (
          <QuestionRow
            key={question.id}
            question={question}
            value={answers[question.id] ?? question.default}
            onChange={(value) => setAnswer(question.id, value)}
          />
        ))}

        <div className="intake-actions">
          <button type="button" className="plan-button" onClick={() => void submitAnswers()}>
            <span className="button-label">Build it with these answers</span>
            <span className="button-arrow">↗</span>
          </button>
          <button type="button" className="suggestion" onClick={() => void skipQuestions()}>
            You decide — use your defaults
          </button>
        </div>
      </div>
    </section>
  );
}

function QuestionRow({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="question">
      <legend>{question.prompt}</legend>

      <div className="question-meta">
        {question.why && (
          <p className="question-why">
            <span className="panel-mono">WHY I CAN&apos;T DECIDE</span> {question.why}
          </p>
        )}
        {question.impact && (
          <p className="question-impact">
            <span className="panel-mono">WHAT CHANGES</span> {question.impact}
          </p>
        )}
      </div>

      {question.options.length > 0 ? (
        <div className="question-options">
          {question.options.map((option) => (
            <label
              key={option.value}
              className={`option${value === option.value ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name={question.id}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                {option.hint && <em>{option.hint}</em>}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <input
          className="question-input"
          type={question.kind === 'number' ? 'number' : 'text'}
          value={value}
          min={question.min}
          max={question.max}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {question.default && (
        <p className="question-default">
          <span className="panel-mono">MY DEFAULT</span> {question.default}
          {question.unit ? ` ${question.unit}` : ''}
        </p>
      )}
    </fieldset>
  );
}