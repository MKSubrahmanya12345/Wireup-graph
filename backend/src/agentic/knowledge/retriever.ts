/**
 * Retrieval over the Wireup device knowledge base.
 *
 * Lightweight lexical RAG: the brief is normalised and scored against every
 * device's aliases, name and summary terms. The best-scoring devices are what
 * the planner/synthesiser is allowed to use — no retrieval, no part.
 */

import type { ArchitectureGraph } from '../../schemas/architecture.js';
import { DEVICE_KNOWLEDGE, BOARD_PROFILES, type DeviceKnowledge } from './devices.js';

export interface RetrievalHit {
  device: DeviceKnowledge;
  score: number;
  /** The alias that won (useful for the build log). */
  matchedOn: string;
}

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
}

/** Words that describe a thing, never a specific part — excluded from matching. */
const GENERIC_TOKENS = new Set([
  'sensor', 'module', 'display', 'screen', 'board', 'light', 'temperature', 'humidity',
  'pressure', 'motion', 'distance', 'smoke', 'water', 'micro', 'mini', 'power', 'switch',
  'motor', 'wire', 'cheap', 'analog', 'digital', 'waterproof', 'single', 'channel',
  'status', 'indicator', 'capacitive', 'barometric', 'barometer', 'plant', 'probe',
  'relay', 'servo', 'oled', 'ultrasonic', 'level', 'monitor', 'meter', 'reader',
  'device', 'thing', 'esp32', 'arduino', 'wire', 'passive', 'buzzer', 'small',
]);

function scoreDevice(haystack: string, device: DeviceKnowledge): RetrievalHit | null {
  let best: RetrievalHit | null = null;
  for (const alias of device.aliases) {
    const needle = ` ${alias.toLowerCase()} `;
    if (haystack.includes(needle)) {
      // Longer aliases are more specific — worth more. Multi-word worth more still.
      const score = alias.length + (alias.includes(' ') ? 6 : 0);
      if (!best || score > best.score) best = { device, score, matchedOn: alias };
    }
  }
  // Name tokens (e.g. "DHT22" inside the full name) count too, slightly less.
  // Only tokens that identify the part (digits or rare words) — never generic
  // nouns like "sensor", or mentioning "a sensor" would retrieve everything.
  if (!best) {
    for (const token of device.name.toLowerCase().split(/[^a-z0-9]+/)) {
      if (!token || token.length < 3) continue;
      if (GENERIC_TOKENS.has(token)) continue;
      const looksLikePartNumber = /[0-9]/.test(token);
      if (!looksLikePartNumber && token.length < 6) continue;
      if (haystack.includes(` ${token} `)) {
        best = { device, score: token.length, matchedOn: token };
        break;
      }
    }
  }
  return best;
}

/** Retrieve devices mentioned in a brief, best first, deduped. */
export function retrieveFromBrief(brief: string): RetrievalHit[] {
  const haystack = normalise(brief);
  const hits: RetrievalHit[] = [];
  for (const device of DEVICE_KNOWLEDGE) {
    const hit = scoreDevice(haystack, device);
    if (hit) hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Retrieve devices mentioned anywhere in an existing architecture graph. */
export function retrieveFromGraph(graph: ArchitectureGraph): RetrievalHit[] {
  const text = normalise(
    graph.nodes
      .map((node) => `${node.name} ${node.partNumber ?? ''} ${node.description}`)
      .join(' '),
  );
  const hits: RetrievalHit[] = [];
  for (const device of DEVICE_KNOWLEDGE) {
    const hit = scoreDevice(text, device);
    if (hit) hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Which board does the brief/graph imply? ESP32 family is the default target. */
export function detectBoard(brief: string, graph?: ArchitectureGraph): {
  board: (typeof BOARD_PROFILES)[number];
  matchedOn: string;
} {
  const text = normalise(
    brief +
      ' ' +
      (graph?.nodes ?? [])
        .filter((node) => node.type === 'controller')
        .map((node) => `${node.name} ${node.partNumber ?? ''}`)
        .join(' '),
  );
  const fallback = BOARD_PROFILES[0]!;
  if (text.includes(' esp32 s3 ') || text.includes(' esp32s3 ') || text.includes(' esp32-s3 ')) {
    return { board: BOARD_PROFILES.find((b) => b.id === 'esp32-s3-devkit') ?? fallback, matchedOn: 'esp32-s3' };
  }
  // Any ESP32 mention, or no mention at all → the classic DevKit profile.
  return { board: fallback, matchedOn: text.includes(' esp32 ') ? 'esp32' : '(default)' };
}

/** Facts used as RAG sources in the build log. */
export function retrievalSources(hits: RetrievalHit[]): { title: string; url: string; usedFor: string }[] {
  return hits.map((hit) => ({
    title: `${hit.device.manufacturer} — ${hit.device.name}`,
    url: hit.device.datasheet,
    usedFor: `Matched "${hit.matchedOn}" (score ${hit.score}) — firmware driver + wiring facts`,
  }));
}
