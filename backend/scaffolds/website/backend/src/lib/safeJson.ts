/** Tolerantly parse a JSON-ish string the device returned. Never throws. */
export function safeJson(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Read a nested key defensively: get(obj, 'a.b.c'). */
export function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
