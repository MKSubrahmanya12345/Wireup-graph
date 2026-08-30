/**
 * Regression: Bedrock models (Kimi K2, MiniMax, Nova) emit explicit `null`
 * for fields that don't apply (e.g. "unit" on a yes/no question) instead of
 * omitting the key. Before the fix, the interpret pass called
 * interpretResponseSchema.parse() on that JSON and 500'd with:
 *
 *   ZodError: Expected string, received null at questions.0.unit
 *
 * Zod's .optional()/.default() treat `undefined` as absent but REJECT `null`,
 * so every LLM-authored schema now normalises nulls deterministically. This
 * test pins that contract using realistic Bedrock model responses.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { interpretResponseSchema, interpretBodySchema } = await import(
  '../src/schemas/requirements.ts'
);
const {
  architectureGraphSchema,
  verificationReportSchema,
} = await import('../src/schemas/architecture.ts');
const {
  firmwareResultSchema,
  websiteRequirementsSchema,
  websiteBuildSchema,
} = await import('../src/schemas/build.ts');
const { parseLlmJson, LlmError } = await import('../src/services/llmService.ts');

// What moonshotai.kimi-k2.5 returned for the DHT22+ESP32 brief: nearly
// perfect JSON, but every inapplicable field is an explicit null.
const kimiInterpretResponse = {
  requirements: {
    project: 'DHT22 ESP32 local dashboard',
    intent:
      'Read temp/humidity from a DHT22 and view it on a website on your computer.',
    domain: 'iot',
    mechanical: {
      mobility: 'static',
      legCount: null,
      minDofPerLeg: null,
      gait: null,
      payloadGrams: null,
      legLengthCm: null,
    },
    power: { source: 'usb', rechargeable: null, targetRuntimeMinutes: null },
    constraints: {},
    assumptions: ['DHT22 wired to GPIO4 with a 10k pull-up', 'Local network only'],
    confidence: 0.72,
  },
  questions: [
    {
      id: 'local-network',
      prompt: 'Should the dashboard be viewable only on your local network?',
      why: null,
      impact: 'Determines whether auth is needed.',
      kind: 'boolean',
      options: [],
      default: 'true',
      unit: null,
      min: null,
      max: null,
    },
    {
      id: 'sample-rate',
      prompt: 'How often should the sensor be read?',
      why: 'The brief does not say.',
      impact: 'Firmware delay and storage growth.',
      kind: 'number',
      options: [
        { value: '2', label: 'Every 2 seconds', hint: null },
        { value: '10', label: 'Every 10 seconds', hint: null },
      ],
      default: '5',
      unit: 'seconds',
      min: 1,
      max: null,
    },
  ],
  assumptions: null,
  ready: false,
};

describe('Bedrock model output with explicit null fields', () => {
  it('interpret response parses the exact Kimi-style payload that used to 500', () => {
    const result = parseLlmJson(
      JSON.stringify(kimiInterpretResponse),
      interpretResponseSchema,
      { label: 'interpret', provider: 'bedrock' },
    );

    assert.equal(result.ready, false);
    assert.equal(result.questions.length, 2);

    // The field from the original crash report.
    assert.equal(result.questions[0].unit, undefined);
    assert.equal(result.questions[0].why, '');
    assert.equal(result.questions[0].min, undefined);
    assert.equal(result.questions[0].max, undefined);

    // Values that ARE present survive untouched.
    assert.equal(result.questions[0].default, 'true');
    assert.equal(result.questions[1].unit, 'seconds');
    assert.equal(result.questions[1].options[0].hint, undefined);
    assert.equal(result.questions[1].options[0].value, '2');

    assert.equal(result.requirements.project, 'DHT22 ESP32 local dashboard');
    assert.equal(result.requirements.mechanical.legCount, undefined);
    assert.equal(result.requirements.mechanical.mobility, 'static');
    assert.equal(result.requirements.power.source, 'usb');
    assert.equal(result.requirements.assumptions.length, 2);

    // Top-level assumptions were null -> empty (service falls back).
    assert.deepEqual(result.assumptions, []);
  });

  it('interpret request body tolerates null collections from the client', () => {
    const parsed = interpretBodySchema.parse({
      brief: 'a dht22 sensor i have and esp32',
      answers: null,
      priorQuestions: null,
      feedback: null,
    });
    assert.deepEqual(parsed.answers, {});
    assert.deepEqual(parsed.priorQuestions, []);
    assert.deepEqual(parsed.feedback, []);
  });

  it('graph planner output with null string/array fields parses', () => {
    const graph = {
      project: null,
      summary: null,
      nodes: [
        {
          id: 'esp32',
          type: 'controller',
          name: 'ESP32',
          partNumber: null,
          x: null,
          y: null,
          description: null,
          properties: null,
          ports: null,
          details: null,
          spatial: null,
        },
        { id: 'dht22', type: 'sensor', name: 'DHT22', partNumber: 'AM2302' },
        null,
      ],
      connections: [
        {
          id: null,
          from: 'esp32',
          to: 'dht22',
          fromPort: null,
          toPort: 'data',
          label: null,
          kind: 'data',
          details: null,
        },
        'garbage',
      ],
      dependencies: null,
      software: [{ id: null, name: null, kind: null, version: null, details: null }],
      notes: [null, 'one-wire timing sensitive', 42],
    };

    const result = architectureGraphSchema.parse(graph);
    assert.equal(result.project, 'Untitled hardware system');
    assert.equal(result.nodes.length, 2);
    assert.equal(result.nodes[0].partNumber, null);
    assert.equal(result.nodes[0].x, 120);
    assert.deepEqual(result.nodes[0].ports, []);
    assert.equal(result.connections.length, 1);
    assert.equal(result.connections[0].fromPort, null);
    assert.equal(result.connections[0].label, 'link');
    assert.deepEqual(result.dependencies, []);
    assert.equal(result.software[0].id, 'software');
    assert.deepEqual(result.notes, ['one-wire timing sensitive']);
  });

  it('verification report with null fields parses', () => {
    const result = verificationReportSchema.parse({
      status: null,
      score: null,
      summary: null,
      checks: [
        { id: null, title: null, status: 'pass', detail: null, scope: null, targetId: null },
      ],
      sources: null,
    });
    assert.equal(result.checks[0].id, '');
    assert.equal(result.checks[0].scope, 'graph');
    assert.equal(result.sources.length, 0);
    assert.equal(typeof result.score, 'number');
  });

  it('firmware result with null fields and pathless files parses', () => {
    const result = firmwareResultSchema.parse({
      platform: null,
      board: null,
      language: null,
      framework: null,
      files: [
        null,
        { path: 'firmware/main.ino', content: 'void setup() {}' },
        { path: null, content: 'unwritable' },
      ],
      buildSteps: null,
      notes: [null, 'needs DHT sensor library'],
    });
    assert.equal(result.platform, 'arduino');
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].path, 'firmware/main.ino');
    assert.deepEqual(result.buildSteps, []);
    assert.deepEqual(result.notes, ['needs DHT sensor library']);
  });

  it('website requirements and build plans tolerate nulls', () => {
    const reqs = websiteRequirementsSchema.parse({
      requested: null,
      summary: null,
      device: null,
      readEndpoints: [
        { name: null, path: '/temp', method: null, description: null, dataType: null, unit: null },
      ],
      controlEndpoints: null,
      telemetry: null,
      dataModel: null,
      security: null,
      notes: null,
    });
    assert.equal(reqs.readEndpoints[0].method, 'GET');
    assert.equal(reqs.readEndpoints[0].name, '');

    const build = websiteBuildSchema.parse({
      projectName: null,
      deviceSpecTs: 'export const spec = {};',
      deviceEndpointsTs: 'export const endpoints = [];',
      envExample: null,
      readmeSection: null,
      buildNotes: null,
    });
    assert.equal(build.projectName, 'wireup-device');
    assert.deepEqual(build.buildNotes, []);
  });

  it('parseLlmJson surfaces genuinely-broken output as an LlmError, not a ZodError 500', () => {
    assert.throws(
      () =>
        parseLlmJson('{"questions": "not an object shape"}', interpretResponseSchema, {
          label: 'interpret',
          provider: 'bedrock',
        }),
      (err) => err instanceof LlmError && /schema/.test(err.message),
    );
  });
});
