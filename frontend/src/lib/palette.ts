import type { ConnectionKind, NodeType } from '../types/architecture';

export interface Palette {
  fill: string;
  stroke: string;
  text: string;
}

const GROUPS = {
  compute: { fill: '#e1f1ef', stroke: '#197d7a', text: '#12625f' },
  input: { fill: '#fff4da', stroke: '#e5ae46', text: '#886524' },
  power: { fill: '#fae9e3', stroke: '#d36f56', text: '#934b38' },
  interface: { fill: '#e8eff8', stroke: '#557db3', text: '#426792' },
  software: { fill: '#efe9f3', stroke: '#8b6b9f', text: '#6c4d7d' },
  default: { fill: '#eef2f0', stroke: '#879d9b', text: '#526966' },
} satisfies Record<string, Palette>;

const TYPE_TO_GROUP: Record<NodeType, keyof typeof GROUPS> = {
  controller: 'compute',
  sensor: 'input',
  actuator: 'input',
  power: 'power',
  interface: 'interface',
  communication: 'interface',
  software: 'software',
  passive: 'default',
  mechanical: 'default',
  other: 'default',
};

export function paletteFor(type: NodeType): Palette {
  return GROUPS[TYPE_TO_GROUP[type] ?? 'default'];
}

export const LEGEND: { label: string; color: string }[] = [
  { label: 'compute', color: GROUPS.compute.stroke },
  { label: 'input', color: GROUPS.input.stroke },
  { label: 'interface', color: GROUPS.interface.stroke },
  { label: 'power', color: GROUPS.power.stroke },
];

const CONNECTION_COLORS: Record<ConnectionKind, string> = {
  power: '#d36f56',
  ground: '#879d9b',
  data: '#197d7a',
  analog: '#557db3',
  mechanical: '#8b6b9f',
  dependency: '#b6c1c0',
  other: '#9db8b4',
};

export function connectionColor(kind: ConnectionKind): string {
  return CONNECTION_COLORS[kind] ?? CONNECTION_COLORS.other;
}