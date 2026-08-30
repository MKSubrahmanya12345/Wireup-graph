import type { ArchitectureGraph } from '../schemas/architecture.js';
import {
  websiteBuildSchema,
  type BuildFile,
  type WebsiteBuildPlan,
  type WebsiteRequirements,
} from '../schemas/build.js';
import { callGroq, extractJson } from './groqService.js';
import { loadScaffold } from './scaffoldService.js';

/**
 * Agentic website builder.
 *
 * Assembly strategy — hardcoded scaffold + AI wiring:
 *   1. Load the committed MERN scaffold (the plumbing the AI never writes).
 *   2. Ask the LLM for ONLY the two device-specific files (frontend deviceSpec,
 *      backend deviceEndpoints) plus env hints, guided by the website requirements.
 *   3. Merge deterministically, substituting {project-name} tokens and the
 *      derived .env values.
 *
 * The result is a complete, buildable, hosting-ready MERN codebase.
 */

export const WEBSITE_BUILD_SYSTEM_PROMPT = `You are a full-stack MERN engineer generating the device-specific wiring for an already-complete web scaffold.

A hardcoded, hosting-ready MERN scaffold already exists with:
- backend: Express + optional Mongo, a generic telemetry proxy that reaches the device over the local network, env handling, and a route file that reads from backend/src/config/deviceEndpoints.ts.
- frontend: React + Vite, a generic data-driven dashboard that renders live cards and controls from frontend/src/lib/deviceSpec.ts.

You generate ONLY two TypeScript files and a few env hints. Return JSON ONLY, no markdown fences. Shape:
{
  "projectName": "short kebab/slug name",
  "deviceSpecTs": "FULL content of frontend/src/lib/deviceSpec.ts (must import nothing, must export const deviceSpec: DeviceSpec)",
  "deviceEndpointsTs": "FULL content of backend/src/config/deviceEndpoints.ts (must match the scaffold's expected exports)",
  "envExample": {
    "deviceIp": "192.168.1.100 or the real hint",
    "devicePort": 8081,
    "deviceProtocol": "http",
    "endpointsJson": null
  },
  "readmeSection": "markdown block describing this device's sensors/controls and how to connect",
  "buildNotes": ["notes"]
}

CRITICAL — deviceSpecTs must follow EXACTLY this interface and file shape (type imports are not allowed; inline the types):
export interface DeviceMetric {
  id: string; label: string; unit: string; path: string; numeric: boolean; min?: number; max?: number;
}
export interface DeviceControl {
  id: string; label: string; kind: 'toggle' | 'select' | 'button'; options?: { value: string; label: string }[]; command: Record<string, unknown>;
}
export interface DeviceSpec {
  name: string; tagline: string; metrics: DeviceMetric[]; controls: DeviceControl[]; refreshMs: number; statusPath: string;
}
export const deviceSpec: DeviceSpec = { ... };

CRITICAL — deviceEndpointsTs must follow EXACTLY this shape (it imports 'env' from './env.js'):
import { env } from './env.js';
export interface DeviceEndpoint {
  id: string; label: string; path: string; method: 'GET' | 'POST' | 'PUT'; kind: 'text' | 'json'; unit?: string; payload?: boolean;
}
export function deviceBaseUrl(): string { return \`\${env.DEVICE_PROTOCOL}://\${env.DEVICE_IP}:\${env.DEVICE_PORT}\`; }
export function readEndpoints(): DeviceEndpoint[] { return [ ... ]; }
export function controlEndpoints(): DeviceEndpoint[] { return [ ... ]; }
export function deviceInfo(): Record<string, string> { return { name: '...', firmware: '...', transport: 'http-lan' }; }

- Every readEndpoints entry id must match a DeviceMetric id in deviceSpecTs.
- Every controlEndpoints id must match a DeviceControl id in deviceSpecTs.
- Only include endpoints the firmware actually exposes (refer to the websiteRequirements and firmware).
- Escape template literals correctly (\${...} in template strings).

The user message is JSON with: projectName, graph (ArchitectureGraph), websiteRequirements (the analysed Website Requirements), and firmwareSummary.`;

const BUILD_MAX_TOKENS = 8_000;

function substituteTokens(files: BuildFile[], projectName: string): BuildFile[] {
  return files.map((file) => ({
    ...file,
    content: file.content.replaceAll('{project-name}', projectName),
  }));
}

function applyEnvExample(
  files: BuildFile[],
  envExample: WebsiteBuildPlan['envExample'],
): BuildFile[] {
  const target = files.find((file) => file.path === 'backend/.env.example');
  if (!target || !envExample) return files;

  let content = target.content;
  const replacements: Array<[string | RegExp, string]> = [];
  if (envExample.deviceIp) {
    replacements.push([/^DEVICE_IP=.*$/m, `DEVICE_IP=${envExample.deviceIp}`]);
  }
  if (envExample.devicePort) {
    replacements.push([/^DEVICE_PORT=.*$/m, `DEVICE_PORT=${envExample.devicePort}`]);
  }
  if (envExample.deviceProtocol) {
    replacements.push([
      /^DEVICE_PROTOCOL=.*$/m,
      `DEVICE_PROTOCOL=${envExample.deviceProtocol}`,
    ]);
  }
  if (envExample.endpointsJson) {
    replacements.push([
      /^DEVICE_ENDPOINTS_JSON=.*$/m,
      `DEVICE_ENDPOINTS_JSON=${envExample.endpointsJson}`,
    ]);
  }
  for (const [pattern, value] of replacements) {
    content = content.replace(pattern, value);
  }
  return files.map((file) =>
    file.path === 'backend/.env.example' ? { ...file, content } : file,
  );
}

function applyGeneratedFiles(
  files: BuildFile[],
  plan: WebsiteBuildPlan,
): { merged: BuildFile[]; generated: BuildFile[] } {
  const generated: BuildFile[] = [
    { path: 'frontend/src/lib/deviceSpec.ts', content: plan.deviceSpecTs },
    { path: 'backend/src/config/deviceEndpoints.ts', content: plan.deviceEndpointsTs },
  ];

  let merged = files.map((file) => {
    const generatedMatch = generated.find((entry) => entry.path === file.path);
    return generatedMatch ?? file;
  });

  merged = substituteTokens(merged, plan.projectName);
  merged = applyEnvExample(merged, plan.envExample);

  if (plan.readmeSection.trim()) {
    merged = merged.map((file) =>
      file.path === 'README.md'
        ? { ...file, content: `${file.content}\n\n---\n\n${plan.readmeSection.trim()}\n` }
        : file,
    );
  }

  return { merged, generated };
}

export interface WebsiteBuildInput {
  projectName: string;
  graph: ArchitectureGraph;
  websiteRequirements: WebsiteRequirements | null;
  firmwareSummary?: {
    platform?: string;
    board?: string;
    files?: Array<{ path: string; content?: string }>;
    notes?: string[];
  } | null;
}

export async function buildWebsite(input: WebsiteBuildInput) {
  const scaffold = await loadScaffold();

  const content = await callGroq(
    [
      { role: 'system', content: WEBSITE_BUILD_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          projectName: input.projectName,
          graph: input.graph,
          websiteRequirements: input.websiteRequirements ?? null,
          firmwareSummary: input.firmwareSummary ?? null,
        }),
      },
    ],
    BUILD_MAX_TOKENS,
  );

  const plan = websiteBuildSchema.parse(extractJson(content));
  const { merged, generated } = applyGeneratedFiles(scaffold, plan);

  return {
    projectName: plan.projectName,
    mergedFiles: merged,
    generatedFiles: generated,
    scaffoldFiles: scaffold.length,
    vercel: { config: 'vercel.json', frontend: 'frontend', backend: 'backend' },
    buildNotes: plan.buildNotes,
  };
}
