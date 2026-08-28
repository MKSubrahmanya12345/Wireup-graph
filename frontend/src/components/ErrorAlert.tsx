import { useGraphStore } from '../store/useGraphStore';

export default function ErrorAlert() {
  const error = useGraphStore((state) => state.error);
  const submitPlan = useGraphStore((state) => state.submitPlan);
  const dismissError = useGraphStore((state) => state.dismissError);

  if (!error) return null;

  return (
    <div className="alert visible" role="alert">
      <span>{error}</span>
      <span className="alert-actions">
        <button type="button" data-testid="button-retry-plan" onClick={() => void submitPlan()}>
          Retry
        </button>
        <button type="button" onClick={dismissError}>
          Dismiss
        </button>
      </span>
    </div>
  );
}