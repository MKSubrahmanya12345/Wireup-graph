import type { ArchitectureGraph } from '../schemas/architecture.js';
import type { RequirementsSpec } from '../schemas/requirements.js';
import {
  websiteRequirementsSchema,
  type WebsiteRequirements,
} from '../schemas/build.js';
import { callLlm, parseLlmJson, type LlmProvider } from './llmService.js';

/**
 * Agentic website-requirements analyser.
 *
 * This is the "Website Requirements" section the user asked for: the exact
 * info a companion web app needs to connect to the hardware over the same
 * Wi-Fi / local network — endpoints the firmware exposes, the data model, and
 * the device connection details. It runs AFTER firmware generation.
 */

export const WEBSITE_REQUIREMENTS_SYSTEM_PROMPT = `You analyse a hardware design and produce the requirements for a companion WEBSITE (a MERN dashboard) that connects to the device over the same Wi-Fi / local network.

Decide first whether the human actually wants a website. They may have explicitly asked for one, or their brief implies it (remote monitoring, dashboard, control from a phone/browser, "access from a web page", telemetry UI, etc.). If NOT indicated, set requested: false and return a minimal document.

Return JSON ONLY, no markdown fences. Shape:
{
  "requested": true,
  "summary": "one paragraph describing the website's job",
  "device": {
    "name": "device name",
    "connection": "wifi | ethernet | serial | ble | cellular | other",
    "localIpHint": "e.g. 192.168.1.100 or null if unknown",
    "port": 8081,
    "protocol": "http",
    "endpointBase": "e.g. http://<device-ip>:8081/api",
    "ssidHint": "e.g. MyHomeWiFi or null",
    "credentialsRequired": false
  },
  "readEndpoints": [
    {"name":"temperature","path":"/api/sensor/temperature","method":"GET","description":"live temp","dataType":"json","unit":"°C","sampleIntervalMs":3000}
  ],
  "controlEndpoints": [
    {"name":"led","path":"/api/control/led","method":"POST","description":"toggle LED","bodyType":"json","commandOptions":["on","off"]}
  ],
  "telemetry": {
    "livePath": "/api/telemetry/live",
    "historyPath": "/api/telemetry/history",
    "sampleRateMs": 3000,
    "retentionDays": 30
  },
  "dataModel": [
    {"field":"temperature","type":"number","unit":"°C","source":"DHT22 sensor"}
  ],
  "security": ["same-LAN only", "optional API token"],
  "notes": ["anything the build needs to know"]
}

The website connects to the device's HTTP endpoints over the local network, so every read/control endpoint you list must correspond to an endpoint the firmware actually exposes (refer to the firmware file list / software modules in the graph).

The user message is JSON with: brief, projectName, graph (ArchitectureGraph), and firmwareSummary (the firmware that was generated just before this step, if available).`;

const REQ_MAX_TOKENS = 3_500;

export interface WebsiteRequirementsInput {
  brief: string;
  projectName: string;
  graph: ArchitectureGraph;
  firmwareSummary?: {
    platform?: string;
    board?: string;
    files?: Array<{ path: string }>;
    notes?: string[];
  } | null;
  provider?: LlmProvider;
  model?: string;
}

export async function generateWebsiteRequirements(
  input: WebsiteRequirementsInput,
): Promise<WebsiteRequirements> {
  const content = await callLlm(
    [
      { role: 'system', content: WEBSITE_REQUIREMENTS_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          brief: input.brief.slice(0, 6_000),
          projectName: input.projectName,
          graph: input.graph,
          firmwareSummary: input.firmwareSummary ?? null,
        }),
      },
    ],
    {
      provider: input.provider,
      model: input.model,
      maxTokens: REQ_MAX_TOKENS,
      jsonResponse: true,
    },
  );

  return parseLlmJson(content, websiteRequirementsSchema, {
    label: 'Website requirements response',
    provider: input.provider,
  });
}

/** Builds a firmware summary object from a generated firmware result. */
export function firmwareSummaryFrom(result: {
  platform?: string;
  board?: string;
  files?: Array<{ path: string; content?: string }>;
  notes?: string[];
} | null): WebsiteRequirementsInput['firmwareSummary'] {
  if (!result) return null;
  return {
    platform: result.platform,
    board: result.board,
    files: (result.files ?? []).map((file) => ({ path: file.path })),
    notes: result.notes,
  };
}
