import type { SpecNodeStatus } from '../types/specGraph';

export interface StatusMeta {
  label: string;
  /** CSS color used for dot, border, chip text. */
  color: string;
  /** Dimmed fill for chips/dots. */
  fill: string;
}

export const STATUS_META: Record<SpecNodeStatus, StatusMeta> = {
  validated: { label: 'validated', color: '#34d399', fill: 'rgba(52, 211, 153, 0.12)' },
  user_confirmed: { label: 'user confirmed', color: '#60a5fa', fill: 'rgba(96, 165, 250, 0.12)' },
  assumed: { label: 'assumed', color: '#94a3b8', fill: 'rgba(148, 163, 184, 0.12)' },
  unresolved: { label: 'unresolved', color: '#fbbf24', fill: 'rgba(251, 191, 36, 0.14)' },
  needs_revalidation: { label: 'revalidate', color: '#fb923c', fill: 'rgba(251, 146, 60, 0.14)' },
};

export function statusMeta(status: SpecNodeStatus | undefined): StatusMeta {
  return STATUS_META[status ?? 'unresolved'] ?? STATUS_META.unresolved;
}
