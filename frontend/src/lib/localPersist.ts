/**
 * Tiny localStorage persistence for the Wireup stores.
 *
 * The tool is local-first: without a Mongo-backed account, a browser refresh
 * used to wipe the graph, the plan and the build result. These helpers make
 * the in-memory stores survive reloads on the same browser.
 */

export function loadPersisted<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

export function persistTo(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded or private mode — non-fatal, the app keeps working */
  }
}

export function clearPersisted(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* non-fatal */
  }
}
