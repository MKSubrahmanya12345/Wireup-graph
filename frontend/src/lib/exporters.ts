import { toPng } from 'html-to-image';
import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react';

import type { ArchitectureGraph } from '../types/architecture';

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'architecture'
  );
}

function triggerDownload(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

/** Captures the React Flow viewport at full graph bounds. */
export async function exportGraphPng(
  nodes: Node[],
  graph: ArchitectureGraph,
  viewportEl: HTMLElement,
): Promise<void> {
  if (!nodes.length) throw new Error('Nothing to export yet — generate a plan first.');

  const bounds = getNodesBounds(nodes);
  const width = Math.round(Math.min(2400, Math.max(1200, bounds.width + 260)));
  const height = Math.round(Math.min(1800, Math.max(700, bounds.height + 240)));
  const viewport = getViewportForBounds(bounds, width, height, 0.1, 2, 0.18);

  const dataUrl = await toPng(viewportEl, {
    backgroundColor: '#fbfcfb',
    width,
    height,
    pixelRatio: 2,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  });

  // Filename comes from the live project name, never a hardcoded demo string.
  triggerDownload(dataUrl, `${slugify(graph.project)}-architecture.png`);
}

export function exportGraphJson(graph: ArchitectureGraph): void {
  const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${slugify(graph.project)}-graph.json`);
  URL.revokeObjectURL(url);
}

/**
 * The canvas registers its viewport node here so the topbar export button
 * (which lives in the shell, outside the canvas) can reach it.
 */
let registeredViewport: HTMLElement | null = null;

export function registerViewport(el: HTMLElement | null): void {
  registeredViewport = el;
}

export function getViewportElement(): HTMLElement | null {
  return registeredViewport;
}