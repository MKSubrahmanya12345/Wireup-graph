import { useToastStore } from '../store/useToastStore';

export default function Toast() {
  const message = useToastStore((state) => state.message);

  return (
    <div className={`toast${message ? ' visible' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}