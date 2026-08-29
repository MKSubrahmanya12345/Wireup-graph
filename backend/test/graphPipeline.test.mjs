/**
 * Regression tests for the graph pipeline.
 *
 * These exist because the failure mode is silent: an LLM returns JSON that is
 * *almost* right, Zod accepts it, and the human gets a diagram with edges
 * floating in space or components stacked on top of each other. Nothing throws.
 * So the contract is pinned here instead.
 *
 * Run with: bun test  |  npm test  |  node --import tsx --test
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import * as esbuild from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const { repairGraph } = await import('../src/data/repairGraph.ts');
const { runStructuralChecks } = await import('../src/data/architectureVerifier.ts');
const { runEngineeringChecks, hasBlockingIssue } = await import('../src/data/engineeringRules.ts');
const { officialComponentCatalog } = await import('../src/data/componentCatalog.ts');
const { emptyGraph, normaliseGraph } = await import('../src/schemas/architecture.ts');

/**
 * The frontend adapter ships in another package, so bundle it on the fly and
 * test the real module rather than a copy of its logic.
 */
async function loadFrontendAdapter() {
  const dir = mkdtempSync(path.join(tmpdir(), 'wireup-adapter-'));
  const outfile = path.join(dir, 'graphAdapter.mjs');
  await esbuild.build({
    entryPoints: [path.resolve(here, '../../frontend/src/lib/graphAdapter.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    // Type-only import; nothing is used at runtime.
    external: ['@xyflow/react'],
    logLevel: 'silent',
  });
  return import(outfile);
}

const adapter = await loadFrontendAdapter();

/** Messy in the specific ways the planner is messy. */
const messyPlannerOutput = () => ({
  project: 'Soil monitor',
  summary: 's',
  nodes: [
    {
      id: 'mcu', type: 'microcontroller', name: 'ESP32', partNumber: 'ESP32-WROOM-32',
      x: 120, y: 120, description: 'controller',
      ports: [
        { id: 'vcc', label: 'VCC', direction: 'in', signal: 'power' },
        { id: 'gpio4', label: 'GPIO4', direction: 'bidirectional', signal: 'digital' },
      ],
    },
    {
      // No x/y at all — the schema would default this onto 120,120.
      id: 'soil', type: 'sensor', name: 'Soil probe', partNumber: null, description: 'moisture',
      ports: [
        { id: 'vcc', label: 'VCC', direction: 'in', signal: 'power' },
        { id: 'aout', label: 'AOUT', direction: 'out', signal: 'analog' },
      ],
    },
    {
      id: 'batt', type: 'power', name: '18650', partNumber: 'NCR18650B',
      x: 900, y: 500, description: 'battery',
      ports: [{ label: 'B+', direction: 'out', signal: 'power' }], // no id
    },
    { id: 'mcu', type: 'controller', name: 'Duplicate id board' }, // duplicate id, no coords
  ],
  connections: [
    // Ports referenced by LABEL, not id.
    { id: 'c1', from: 'batt', to: 'mcu', fromPort: 'B+', toPort: 'VCC', label: '3.7V', kind: 'power' },
    { id: 'c2', from: 'soil', to: 'mcu', fromPort: 'AOUT', toPort: 'GPIO4', label: 'soil', kind: 'analog' },
    // Endpoint node was never emitted.
    { id: 'c3', from: 'mcu', to: 'cloud', fromPort: 'gpio4', toPort: null, label: 'wifi', kind: 'data' },
    // Self-referencing.
    { id: 'c4', from: 'mcu', to: 'mcu', fromPort: 'gpio4', toPort: 'gpio4', label: 'loop', kind: 'data' },
    // Reuses c1's id, and names a pin that does not exist.
    { id: 'c1', from: 'soil', to: 'batt', fromPort: 'vcc', toPort: 'NOPE', label: 'gnd', kind: 'ground' },
  ],
  dependencies: [], software: [], notes: [],
});

describe('repairGraph', () => {
  it('gives duplicate node ids a stable, unique replacement', () => {
    const { graph, repairs } = repairGraph(messyPlannerOutput());
    const ids = graph.nodes.map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length, `ids were not unique: ${ids}`);
    assert.ok(repairs.some((r) => r.code === 'NODE_DUPLICATE_ID'));
  });

  it('assigns an id to a port that only has a label', () => {
    const { graph } = repairGraph(messyPlannerOutput());
    const batt = graph.nodes.find((node) => node.name === '18650');
    assert.ok(batt.ports.length > 0);
    assert.ok(batt.ports.every((port) => port.id.length > 0), 'a port still has an empty id');
  });

  it('resolves a port reference written as a label, case-insensitively', () => {
    const { graph } = repairGraph(messyPlannerOutput());
    const power = graph.connections.find((c) => c.label === '3.7V');
    const mcu = graph.nodes.find((node) => node.name === 'ESP32');
    assert.ok(mcu.ports.some((port) => port.id === power.toPort),
      `"${power.toPort}" is not a real pin on the MCU`);
  });

  it('drops connections whose endpoint is not a component', () => {
    const { graph, repairs } = repairGraph(messyPlannerOutput());
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const c of graph.connections) {
      assert.ok(ids.has(c.from) && ids.has(c.to), `dangling connection survived: ${c.id}`);
    }
    assert.ok(repairs.some((r) => r.code === 'CONNECTION_DANGLING'));
  });

  it('drops self-referencing connections', () => {
    const { graph } = repairGraph(messyPlannerOutput());
    assert.equal(graph.connections.filter((c) => c.from === c.to).length, 0);
  });

  it('makes connection ids unique', () => {
    const { graph } = repairGraph(messyPlannerOutput());
    const ids = graph.connections.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `connection ids were not unique: ${ids}`);
  });

  it('detaches a reference to a pin that does not exist instead of dropping the link', () => {
    const { graph, repairs } = repairGraph(messyPlannerOutput());
    const gnd = graph.connections.find((c) => c.label === 'gnd');
    assert.ok(gnd, 'the link was dropped entirely rather than detached');
    assert.equal(gnd.toPort, null);
    assert.ok(repairs.some((r) => r.code === 'PORT_REF_DROPPED'));
  });

  it('places nodes that have no coordinates, and keeps ones that do', () => {
    const { graph } = repairGraph(messyPlannerOutput());
    const mcu = graph.nodes.find((node) => node.name === 'ESP32');
    const batt = graph.nodes.find((node) => node.name === '18650');
    assert.deepEqual({ x: mcu.x, y: mcu.y }, { x: 120, y: 120 }, 'moved a node the model placed');
    assert.deepEqual({ x: batt.x, y: batt.y }, { x: 900, y: 500 }, 'moved a node the model placed');
    for (const node of graph.nodes) {
      assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), `${node.id} has no position`);
    }
  });

  it('leaves no two nodes visually stacked', () => {
    const { graph } = repairGraph(messyPlannerOutput());
    for (let i = 0; i < graph.nodes.length; i += 1) {
      for (let j = i + 1; j < graph.nodes.length; j += 1) {
        const a = graph.nodes[i];
        const b = graph.nodes[j];
        const stacked = Math.abs(a.x - b.x) < 60 && Math.abs(a.y - b.y) < 60;
        assert.ok(!stacked, `${a.id} and ${b.id} are stacked at ${a.x},${a.y}`);
      }
    }
  });

  it('degrades a non-graph payload to an empty graph rather than throwing', () => {
    // Deliberately lenient: a bad planner turn should cost one revision, not
    // the request. The controller separately flags this via normaliseGraph.
    const { graph, repairs } = repairGraph({ nodes: 'not-an-array', connections: 42 });
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.connections.length, 0);
    assert.deepEqual(repairs, []);
  });
});

describe('runStructuralChecks', () => {
  it('flags duplicate connection ids', () => {
    // Duplicate ids collide as React Flow keys and overwrite each other's
    // checks below, so a failing link can hide behind a passing namesake.
    const graph = {
      ...emptyGraph(),
      nodes: [
        { id: 'a', type: 'controller', name: 'A', partNumber: null, x: 0, y: 0, description: '', properties: [], ports: [], details: [] },
        { id: 'b', type: 'sensor', name: 'B', partNumber: null, x: 300, y: 0, description: '', properties: [], ports: [], details: [] },
      ],
      connections: [
        { id: 'dup', from: 'a', to: 'b', fromPort: null, toPort: null, label: 'x', kind: 'data', details: '' },
        { id: 'dup', from: 'b', to: 'a', fromPort: null, toPort: null, label: 'y', kind: 'data', details: '' },
      ],
    };
    const idCheck = runStructuralChecks(graph, officialComponentCatalog)
      .find((c) => c.id === 'connection-ids');
    assert.ok(idCheck, 'no connection-id check was produced');
    assert.equal(idCheck.status, 'fail');
    assert.match(idCheck.detail, /dup/);
  });

  it('reports no failures for a repaired graph', () => {
    const { graph } = repairGraph(messyPlannerOutput());
    const checks = runStructuralChecks(graph, officialComponentCatalog);
    const failures = checks.filter((c) => c.status === 'fail');
    assert.deepEqual(failures.map((c) => c.id), [], 'repaired graph still has structural failures');
  });
});

describe('frontend graphAdapter', () => {
  const repaired = repairGraph(messyPlannerOutput()).graph;

  it('resolves every edge to a real handle on both ends', () => {
    const edges = adapter.toFlowEdges(repaired);
    assert.ok(edges.length > 0, 'no edges were produced');
    for (const edge of edges) {
      assert.ok(edge.sourceHandle, `edge ${edge.id} has no source handle`);
      assert.ok(edge.targetHandle, `edge ${edge.id} has no target handle`);
    }
  });

  it('emits handle ids that the node component actually renders', () => {
    const edges = adapter.toFlowEdges(repaired);
    for (const edge of edges) {
      const source = repaired.nodes.find((n) => n.id === edge.source);
      const target = repaired.nodes.find((n) => n.id === edge.target);
      const sourceOk = source.ports.some((p) => adapter.sourceHandleId(p.id) === edge.sourceHandle);
      const targetOk = target.ports.some((p) => adapter.targetHandleId(p.id) === edge.targetHandle);
      assert.ok(sourceOk, `source handle ${edge.sourceHandle} is not rendered by ${edge.source}`);
      assert.ok(targetOk, `target handle ${edge.targetHandle} is not rendered by ${edge.target}`);
    }
  });

  it('drops duplicate connection ids rather than letting React Flow collide', () => {
    const graph = {
      ...emptyGraph(),
      nodes: repaired.nodes,
      connections: [
        { id: 'same', from: repaired.nodes[0].id, to: repaired.nodes[1].id, fromPort: null, toPort: null, label: 'a', kind: 'data', details: '' },
        { id: 'same', from: repaired.nodes[1].id, to: repaired.nodes[0].id, fromPort: null, toPort: null, label: 'b', kind: 'data', details: '' },
      ],
    };
    assert.equal(adapter.toFlowEdges(graph).length, 1);
  });

  it('detects two overlapping nodes as needing layout', () => {
    const stacked = [
      { id: 'a', x: 120, y: 120 },
      { id: 'b', x: 120, y: 120 },
      { id: 'c', x: 900, y: 900 },
    ];
    assert.equal(adapter.needsAutoLayout(stacked), true,
      'two nodes at identical coordinates were not flagged');
  });

  it('does not demand a relayout of a readable graph', () => {
    const spread = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 400, y: 0 },
      { id: 'c', x: 800, y: 0 },
    ];
    assert.equal(adapter.needsAutoLayout(spread), false);
  });
});

describe('normaliseGraph', () => {
  it('reports an unusable client graph instead of silently emptying it', () => {
    const result = normaliseGraph({ nodes: 'not-an-array' });
    assert.equal(result.repaired, true);
    assert.equal(result.graph.nodes.length, 0);
  });

  it('passes a valid graph through untouched', () => {
    const result = normaliseGraph(repairGraph(messyPlannerOutput()).graph);
    assert.equal(result.repaired, false);
    assert.ok(result.graph.nodes.length > 0);
  });
});

describe('planAndVerify (end to end, stubbed LLM)', () => {
  const PLANNER = messyPlannerOutput();
  const VERIFIER = {
    status: 'review',
    score: 55,
    summary: 'stub verdict',
    checks: [{ id: 'model-only-check', title: 'Model check', status: 'review', detail: 'from the model', scope: 'graph' }],
    sources: [{ title: 'Stub source', url: 'https://example.com', usedFor: 'test' }],
  };

  let server;
  let port;
  let plannerCalls = 0;
  let verifierCalls = 0;

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const system = JSON.parse(body).messages?.[0]?.content ?? '';
        const isPlanner = system.includes('senior systems engineer');
        if (isPlanner) plannerCalls += 1; else verifierCalls += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(isPlanner ? PLANNER : VERIFIER) } }],
        }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;

    process.env.GROQ_API_KEY = 'stub-key';
    process.env.GROQ_BASE_URL = `http://127.0.0.1:${port}/openai/v1`;
    process.env.LOG_LEVEL = 'silent';
  });

  after(() => server.close());

  it('returns a renderable graph plus its repairs and validation', async () => {
    const { planAndVerify } = await import('../src/services/architectureService.ts');
    const result = await planAndVerify('build a soil monitor', emptyGraph(), {
      requirements: null,
      feedback: [],
    });

    assert.equal(plannerCalls, 1, 'planner was not called');
    assert.equal(verifierCalls, 1, 'verifier was not called');

    const ids = result.graph.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length);
    const cids = result.graph.connections.map((c) => c.id);
    assert.equal(new Set(cids).size, cids.length);
    assert.equal(result.graph.connections.filter((c) => c.from === c.to).length, 0);

    assert.ok(result.repairs.length > 0, 'no repairs were reported');
    assert.ok(Array.isArray(result.issues));
    assert.equal(typeof result.blocking, 'boolean');

    // The deterministic floor and the model's own checks must both survive.
    const checkIds = result.verification.checks.map((c) => c.id);
    assert.ok(checkIds.includes('node-ids'), 'structural floor was lost');
    assert.ok(checkIds.includes('model-only-check'), 'model checks were dropped');
    assert.deepEqual(
      result.verification.checks.filter((c) => c.status === 'fail').map((c) => c.id),
      [],
      'repaired graph still fails structural checks',
    );
  });
});

describe('runEngineeringChecks', () => {
  it('flags a design whose power source is wired to nothing', () => {
    const graph = {
      ...emptyGraph(),
      nodes: [
        { id: 'batt', type: 'power', name: 'Battery', partNumber: 'NCR18650B', x: 0, y: 0, description: '', properties: [], ports: [], details: [] },
        { id: 'mcu', type: 'controller', name: 'MCU', partNumber: 'ESP32-WROOM-32', x: 300, y: 0, description: '', properties: [], ports: [], details: [] },
      ],
      connections: [],
    };
    const issues = runEngineeringChecks(graph, null);
    assert.ok(issues.some((i) => i.code === 'ORPHAN_NODE'));
    assert.ok(hasBlockingIssue(issues), 'a battery wired to nothing should block');
  });
});
