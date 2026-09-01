/**
 * Bidirectional bridge between page 04 and an EMBEDDED Velxio instance.
 *
 * The other end is `frontend/src/utils/embedBridge.ts` inside external/velxio
 * (applied via external/patches/velxio-embed-bridge.patch). Protocol, all
 * window.postMessage with JSON payloads, origin-checked both ways:
 *
 *   velxio → wireup  { type: 'velxio:ready' }                     it booted
 *   wireup → velxio  { type: 'velxio:load-vlx', vlx }             push build
 *   velxio → wireup  { type: 'velxio:vlx-loaded', name }          push ack
 *   wireup → velxio  { type: 'velxio:export-vlx' }                pull request
 *   velxio → wireup  { type: 'velxio:vlx-export', vlx }           canvas state
 *   velxio → wireup  { type: 'velxio:vlx-error', message }        either failed
 *
 * So the user never manually imports the .vlx: the build's circuit lands on
 * the canvas the moment the iframe is ready, and canvas edits can be pulled
 * back into this build's diagram.json without leaving the page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Mirrors Velxio's VlxPayload closely enough to hand back and forth. */
export interface VlxCanvasPayload {
  format: string;
  version: number;
  name?: string;
  boards: { id: string; boardKind?: string; activeFileGroupId?: string }[];
  fileGroups: Record<string, { name: string; content: string }[]>;
  components: { id: string; metadataId: string; x: number; y: number; properties?: Record<string, unknown> }[];
  wires: {
    id: string;
    start: { componentId: string; pinName: string };
    end: { componentId: string; pinName: string };
  }[];
  activeBoardId?: string | null;
}

export type BridgeStatus =
  | { state: 'idle' }
  | { state: 'waiting' } // iframe mounted, no velxio:ready yet
  | { state: 'ready' } // velxio answered, nothing pushed yet
  | { state: 'pushed'; name: string | null }
  | { state: 'error'; message: string };

export interface VelxioBridge {
  status: BridgeStatus;
  /** Push a .vlx (JSON string) onto the embedded canvas. */
  push: (vlxJson: string) => void;
  /** Pull the current canvas back as a VlxPayload. Rejects on bridge errors. */
  pull: () => Promise<VlxCanvasPayload>;
  /** Attach to the iframe element. */
  frameRef: (node: HTMLIFrameElement | null) => void;
}

export function useVelxioBridge(embedUrl: string | null, autoPushVlx: string | null): VelxioBridge {
  const [status, setStatus] = useState<BridgeStatus>({ state: 'idle' });
  const frame = useRef<HTMLIFrameElement | null>(null);
  const pullResolvers = useRef<{ resolve: (p: VlxCanvasPayload) => void; reject: (e: Error) => void }[]>([]);
  const autoPush = useRef<string | null>(autoPushVlx);
  autoPush.current = autoPushVlx;

  const origin = embedUrl ? new URL(embedUrl, window.location.href).origin : null;

  const post = useCallback(
    (message: Record<string, unknown>) => {
      if (!frame.current?.contentWindow || !origin) return;
      frame.current.contentWindow.postMessage(message, origin);
    },
    [origin],
  );

  const push = useCallback(
    (vlxJson: string) => {
      post({ type: 'velxio:load-vlx', vlx: vlxJson });
    },
    [post],
  );

  const pull = useCallback((): Promise<VlxCanvasPayload> => {
    return new Promise((resolve, reject) => {
      if (!frame.current?.contentWindow) {
        reject(new Error('The Velxio iframe is not mounted.'));
        return;
      }
      pullResolvers.current.push({ resolve, reject });
      post({ type: 'velxio:export-vlx' });
      // A bridge that never answers is an un-patched Velxio.
      setTimeout(() => {
        const idx = pullResolvers.current.findIndex((r) => r.resolve === resolve);
        if (idx >= 0) {
          pullResolvers.current.splice(idx, 1);
          reject(
            new Error(
              'Velxio did not answer. Apply external/patches/velxio-embed-bridge.patch to your Velxio checkout and restart its frontend.',
            ),
          );
        }
      }, 5_000);
    });
  }, [post]);

  useEffect(() => {
    if (!origin) return undefined;
    setStatus({ state: 'waiting' });

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const message = event.data as { type?: string; name?: string; message?: string; vlx?: VlxCanvasPayload };
      if (!message || typeof message.type !== 'string') return;

      switch (message.type) {
        case 'velxio:ready':
          setStatus({ state: 'ready' });
          // The whole point: the build lands on the canvas unasked.
          if (autoPush.current) post({ type: 'velxio:load-vlx', vlx: autoPush.current });
          break;
        case 'velxio:vlx-loaded':
          setStatus({ state: 'pushed', name: message.name ?? null });
          break;
        case 'velxio:vlx-export': {
          const waiter = pullResolvers.current.shift();
          if (waiter && message.vlx) waiter.resolve(message.vlx);
          break;
        }
        case 'velxio:vlx-error': {
          const detail = message.message ?? 'unknown bridge error';
          const waiter = pullResolvers.current.shift();
          if (waiter) waiter.reject(new Error(detail));
          else setStatus({ state: 'error', message: detail });
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, post]);

  const frameRef = useCallback((node: HTMLIFrameElement | null) => {
    frame.current = node;
  }, []);

  return { status, push, pull, frameRef };
}
