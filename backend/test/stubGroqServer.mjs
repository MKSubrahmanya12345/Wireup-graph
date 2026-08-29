import http from 'node:http';
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
http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const sys = JSON.parse(b).messages?.[0]?.content ?? '';
    const f = sys.includes('senior systems engineer') ? PLANNER : sys.includes('intake engineer') ? INTERPRET : VERIFIER;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(f) } }] }));
  });
}).listen(8899, '127.0.0.1', () => console.log('stub groq on 8899'));
