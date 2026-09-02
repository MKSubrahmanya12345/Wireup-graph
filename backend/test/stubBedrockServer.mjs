/**
 * Standalone Bedrock Converse stub for manual local dev (no AWS account).
 *
 * Run:  node test/stubBedrockServer.mjs
 * Then: LLM_PROVIDER=bedrock AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
 *       AWS_REGION=us-east-1 BEDROCK_ENDPOINT=http://127.0.0.1:8899 npm run dev
 */
import { startBedrockStub } from './bedrockStub.mjs';

const PLANNER = {
  project: 'Soil monitor', summary: 's',
  nodes: [
    { id: 'mcu', type: 'controller', name: 'ESP32', partNumber: 'ESP32-WROOM-32', x: 120, y: 120,
      ports: [ { id: 'vcc', label: 'VCC', direction: 'in', signal: 'power' } ] },
    { id: 'soil', type: 'sensor', name: 'Soil probe', partNumber: null,
      ports: [ { id: 'aout', label: 'AOUT', direction: 'out', signal: 'analog' } ] },
  ],
  connections: [
    { id: 'c1', from: 'soil', to: 'mcu', fromPort: 'AOUT', toPort: 'NOPE', label: 'soil', kind: 'analog' },
    { id: 'c2', from: 'mcu', to: 'ghost', fromPort: null, toPort: null, label: 'dangling', kind: 'data' },
  ],
  dependencies: [], software: [], notes: [],
};
const INTERPRET = {
  requirements: { project: 'Soil monitor', intent: 'A battery-powered soil moisture monitor.', domain: 'sensor',
    mechanical: {}, power: { source: 'battery' }, constraints: {}, assumptions: ['Chose capacitive probe'], confidence: 0.7 },
  questions: [ { id: 'where', prompt: 'Where will it live?', why: 'Changes the enclosure rating.', impact: 'IP rating and battery size.',
    kind: 'single', options: [ { value: 'outdoor', label: 'Outdoors', hint: 'weatherproof' } ], default: 'outdoor', unit: '' } ],
  assumptions: ['Chose capacitive probe'], ready: false,
};
const VERIFIER = { status: 'review', score: 70, summary: 'ok', checks: [], sources: [] };

const stub = await startBedrockStub((system) => {
  const fixture = system.includes('senior systems engineer')
    ? PLANNER
    : system.includes('intake engineer')
      ? INTERPRET
      : VERIFIER;
  return JSON.stringify(fixture);
}, { port: 8899 });

console.log(`stub bedrock (Converse, h2c) on ${stub.port}`);
