/** Format a raw metric value for display. */
export function formatValue(value: unknown, unit: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return `${Number.isInteger(value) ? value : value.toFixed(2)}${unit ? ` ${unit}` : ''}`;
  }
  return `${String(value)}${unit ? ` ${unit}` : ''}`;
}

/** Pretty-print an ISO timestamp. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, { hour12: false });
}

/** Colour for a status badge. */
export function statusTone(status: unknown): 'ok' | 'warn' | 'bad' {
  const value = String(status ?? '').toLowerCase();
  if (['ok', 'online', 'ready', 'healthy', '1', 'true'].includes(value)) return 'ok';
  if (['offline', 'error', 'fault', '0', 'false', 'disconnected'].includes(value)) return 'bad';
  return 'warn';
}
