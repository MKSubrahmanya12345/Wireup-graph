import type { ArchitectureGraph } from '../schemas/architecture.js';
import {
  firmwareResultSchema,
  type FirmwareResult,
} from '../schemas/build.js';
import { callLlm, extractJson, type LlmProvider } from './llmService.js';

/**
 * Agentic firmware generator.
 *
 * Turns the verified architecture graph + the human brief into real embedded
 * source code (Arduino/ESP32-style C++ by default). This is the FIRST artifact
 * the Agentic Build produces — the hardware part — before any website work.
 */

export const FIRMWARE_SYSTEM_PROMPT = `You are a senior embedded firmware engineer. Given a hardware architecture graph (components, ports, connections) and the human's brief, write real, compilable firmware for the target microcontroller.

Return JSON ONLY, no markdown fences. Shape:
{
  "platform": "esp32-arduino | arduino-uno | esp32-platformio | raspberry-pi-pico | other",
  "board": "exact board name, e.g. ESP32 Dev Module",
  "language": "C++",
  "framework": "Arduino | ESP-IDF | PlatformIO | MicroPython",
  "files": [
    {
      "path": "firmware/main.ino",
      "content": "full source code"
    },
    {
      "path": "firmware/sensors.h",
      "content": "header/library source"
    }
  ],
  "buildSteps": ["step", "step"],
  "notes": ["wiring/pin note", "library dependency note"]
}

Hard requirements:
- Files must live under a "firmware/" folder (or "src/") with a platformio.ini / .ino entry point.
- Only reference the exact parts present in the graph nodes (part numbers, pins, buses).
- Map every connection in the graph to real pins/ports. If the graph does not give a pin, pick a sensible default and state it in notes.
- Include: setup(), loop(), proper pinMode/analogRead/digitalWrite, bus init (Wire/Serial/SPI), and a small HTTP server if the brief or graph implies a website/remote access (so the website can connect over the same Wi-Fi). Expose endpoints the "website requirements" will use.
- Do NOT invent component libraries that don't exist. Only standard Arduino libs plus well-known ones (WiFi.h, WebServer.h, Wire.h, Adafruit sensors if listed).
- The code must be realistic and buildable, with no pseudo-code placeholders.

The user message is JSON with: brief, projectName, and graph (full ArchitectureGraph with nodes/connections/dependencies/software).`;

const FIRMWARE_MAX_TOKENS = 8_000;

export interface GenerateFirmwareOptions {
  provider?: LlmProvider;
  model?: string;
}

export async function generateFirmware(
  brief: string,
  projectName: string,
  graph: ArchitectureGraph,
  options?: GenerateFirmwareOptions,
): Promise<FirmwareResult> {
  const content = await callLlm(
    [
      { role: 'system', content: FIRMWARE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          brief: brief.slice(0, 6_000),
          projectName,
          graph,
        }),
      },
    ],
    {
      provider: options?.provider,
      model: options?.model,
      maxTokens: FIRMWARE_MAX_TOKENS,
      jsonResponse: true,
    },
  );

  return firmwareResultSchema.parse(extractJson(content));
}
