import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export type ChatMessage = { role: 'system' | 'user'; content: string };

/** Thrown for any provider-level failure; the controller turns this into a 502. */
export class GroqError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GroqError';
  }
}

export const PLANNER_SYSTEM_PROMPT = `You are the senior systems engineer inside a hardware architecture design tool.
Reason about the user's request and the existing architecture, then return a complete updated architecture as JSON.
Do not explain outside the JSON. Do not wrap it in markdown fences.
The user message is a JSON object with "request" and "graph" fields. Treat the graph as the current source of truth and update it in place.

The response must be an object with exactly these top-level fields:
{
  "project": "short project name",
  "summary": "concise engineering summary",
  "nodes": [
    {
      "id": "stable-kebab-case-id",
      "type": "controller|sensor|actuator|power|interface|passive|communication|software|mechanical|other",
      "name": "human component name",
      "partNumber": "realistic manufacturer part number or null",
      "x": 120,
      "y": 120,
      "description": "what it does in this system",
      "properties": [{"label":"Voltage","value":"3.3 V"}],
      "ports": [{"id":"vcc","label":"VCC","direction":"in|out|bidirectional","signal":"power|ground|digital|analog|i2c|spi|uart|pwm|mechanical|other"}],
      "details": ["build-relevant note"],
      "spatial": {
        "position3d": {"x": 0.0, "y": 0.0, "z": 0.0},
        "rotation3d": {"x": 0.0, "y": 0.0, "z": 0.0},
        "dimensions": {"w": 0.05, "h": 0.03, "d": 0.05},
        "massGrams": 10,
        "modelRef": "generic-board"
      }
    }
  ],
  "connections": [
    {
      "id": "stable-connection-id",
      "from": "node-id",
      "to": "node-id",
      "fromPort": "port-id or signal name",
      "toPort": "port-id or signal name",
      "label": "signal or power name",
      "kind": "power|ground|data|analog|mechanical|dependency|other",
      "details": "wiring or interface details"
    }
  ],
  "dependencies": [
    {"id":"dependency-id","name":"dependency name","kind":"library|firmware|tool|protocol|other","version":"version or null","reason":"why needed"}
  ],
  "software": [
    {"id":"software-id","name":"software item","kind":"firmware|library|tool|service|other","version":"version or null","details":"implementation detail"}
  ],
  "notes": ["risk, assumption, or build note"]
}

The "spatial" field on each node is OPTIONAL — omit it or set it to null if you cannot determine placement.
When present, position3d is in metres in a robot-local frame (origin at geometric centre of the assembly).
Typical sizes: MCU/controller board 0.07×0.03×0.05 m; servo 0.04×0.04×0.04 m; battery 0.07×0.02×0.02 m; sensor 0.02×0.005×0.02 m.
Use modelRef hints: "generic-board", "servo-sg90", "battery-18650", "sensor-small", "generic-box".

Engineering rules:
- Select real, purchasable components when the request has enough detail; state assumptions in notes when it does not.
- Resolve interfaces, voltage levels, power rails, pull-ups, current limits, and dependencies needed to build the system.
- Every connection must reference existing node ids. Every nontrivial component should have ports and build-relevant properties.
- On an edit request, update the existing design instead of rebuilding it from scratch. Preserve stable node ids, user-defined x/y positions, and unaffected metadata. Recalculate affected connections and dependencies for replacements or changed values.
- Return the entire graph, not a patch. Use null for unknown part numbers or versions. Keep the response compact but complete.`;

export const VERIFIER_SYSTEM_PROMPT = `You are an independent hardware design reviewer. You did not create the proposed architecture.
Review the requested change and the complete proposed graph against the official component reference data and the structural checks provided.
Return JSON only, with this shape:
{
  "status": "verified|review|blocked",
  "score": 0,
  "summary": "short decision",
  "checks": [
    {"id":"check-id","title":"check title","status":"pass|review|fail","detail":"specific evidence-based finding","scope":"node|connection|graph","targetId":"optional-id"}
  ],
  "sources": [
    {"title":"official source title","url":"https://official-source.example","usedFor":"what it supports"}
  ]
}
Be conservative: use "verified" only when the component identity, endpoint references, ports, voltage/power assumptions, and interface compatibility are sufficiently supported. Use "review" for unknown part variants, missing pin mappings, or assumptions that need a data-sheet check. Use "blocked" for contradictory voltages, impossible endpoint references, unsafe power paths, or other build-stopping issues.
Do not invent source URLs. Only cite URLs present in the official component bank.`;

/** Handles bare JSON, fenced JSON, and JSON wrapped in prose. */
export function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start === -1 || end <= start) throw new GroqError('Groq returned non-JSON output');
    return JSON.parse(withoutFence.slice(start, end + 1));
  }
}

export async function callGroq(
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  const response = await fetch(`${env.GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.GROQ_MODEL,
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages,
    }),
  });

  if (!response.ok) {
    const providerError = await response.text();
    throw new GroqError(
      `Groq request failed (${response.status}): ${providerError.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new GroqError('Groq response did not contain message content');

  logger.debug({ tokens: maxTokens }, 'Groq call completed');
  return content;
}