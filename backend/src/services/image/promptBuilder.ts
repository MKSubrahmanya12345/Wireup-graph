import type { ArchitectureGraph, ArchitectureNode } from '../../schemas/architecture.js';

/**
 * Prompt builder for hyper-realistic image generation.
 *
 * Rules:
 * 1. Group nodes by (partNumber ?? name) to emit "8× Tower Pro SG90" not 8 lines.
 * 2. Inject real descriptions from node.description.
 * 3. Materials block chosen per node type from lookup table.
 * 4. Arrangement derived from position3d, else from node types.
 * 5. Camera block is fixed — no model improvisation.
 * 6. Negative prompt is mandatory.
 */

interface GroupedComponent {
  count: number;
  partNumber: string | null;
  name: string;
  description: string;
  type: string;
}

/**
 * Group nodes by (partNumber ?? name) so identical components collapse
 * into a single line with a count prefix.
 */
function groupComponents(nodes: ArchitectureNode[]): GroupedComponent[] {
  const groups = new Map<string, GroupedComponent>();

  for (const node of nodes) {
    const key = node.partNumber ?? node.name;
    const existing = groups.get(key);

    if (existing) {
      existing.count++;
    } else {
      groups.set(key, {
        count: 1,
        partNumber: node.partNumber,
        name: node.name,
        description: node.description,
        type: node.type,
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    // Sort by count (descending), then by name for stability.
    if (a.count !== b.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Build the materials block based on the node types present.
 * Returns an array of material description lines.
 */
function buildMaterialsBlock(nodes: ArchitectureNode[]): string[] {
  const materials: string[] = [];
  const typeSet = new Set(nodes.map((n) => n.type));

  // Servos / actuators: moulded ABS + nylon horn
  if (typeSet.has('actuator') || nodes.some((n) => n.name.toLowerCase().includes('servo'))) {
    materials.push('Moulded ABS plastic with nylon horn actuators.');
  }

  // Controllers / MCU: matte QFN on FR4 with silkscreen
  if (typeSet.has('controller') || typeSet.has('interface')) {
    materials.push('Matte QFN microcontroller on FR4 PCB with silkscreen labelling.');
  }

  // Power / battery: brushed steel + PVC wrap
  if (typeSet.has('power') || nodes.some((n) => n.name.toLowerCase().includes('battery'))) {
    materials.push('Brushed steel battery casing with PVC insulation wrap.');
  }

  // Passive: 0603 packages
  if (typeSet.has('passive')) {
    materials.push('0603 surface-mount passive components.');
  }

  // Sensors: small precision enclosures
  if (typeSet.has('sensor')) {
    materials.push('Precision thermoplastic sensor enclosures.');
  }

  // Mechanical: aluminum and steel hardware
  if (typeSet.has('mechanical') || nodes.length > 0) {
    materials.push('Injection-moulded plastic, anodised aluminium, machined steel hardware.');
  }

  return materials.length > 0
    ? materials
    : ['Generic industrial enclosure materials, anodised aluminium hardware.'];
}

/**
 * Derive arrangement description from spatial data or node types.
 * If position3d is present on any node, describe the layout from positions.
 * Otherwise, infer from node types.
 */
function buildArrangementBlock(nodes: ArchitectureNode[]): string {
  const hasPosition3d = nodes.some((n) => n.spatial?.position3d);

  if (hasPosition3d) {
    // Calculate bounding box and center
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const node of nodes) {
      const pos = node.spatial?.position3d;
      if (pos) {
        minX = Math.min(minX, pos.x || 0);
        maxX = Math.max(maxX, pos.x || 0);
        minY = Math.min(minY, pos.y || 0);
        maxY = Math.max(maxY, pos.y || 0);
        minZ = Math.min(minZ, pos.z || 0);
        maxZ = Math.max(maxZ, pos.z || 0);
      }
    }

    const width = Math.abs(maxX - minX) || 0.1;
    const height = Math.abs(maxY - minY) || 0.1;
    const depth = Math.abs(maxZ - minZ) || 0.1;

    return `Components arranged in a compact 3D assembly: approximately ${(width * 100).toFixed(0)} cm wide, ${(height * 100).toFixed(0)} cm tall, ${(depth * 100).toFixed(0)} cm deep. Central controller with distributed sensors and actuators.`;
  }

  // Infer from node types
  const legNodes = nodes.filter((n) => n.type === 'actuator' || n.name.toLowerCase().includes('leg'));
  const controllerNodes = nodes.filter((n) => n.type === 'controller');

  if (legNodes.length > 2 && controllerNodes.length > 0) {
    const legCount = legNodes.length;
    const angleStep = Math.round(360 / legCount);
    return `Legged assembly with ${legCount} actuated legs radially positioned at ${angleStep}° intervals around a central controller body.`;
  }

  if (nodes.some((n) => n.type === 'power')) {
    return `Central power distribution with controller and peripheral modules arranged in a compact stacked or side-by-side configuration.`;
  }

  return 'Compact assembly with controller at the centre and modular peripheral components positioned for accessible wiring.';
}

/**
 * Build the complete prompt for image generation (max 2048 chars for Cloudflare).
 * Cloudflare endpoint only accepts 'prompt' field, so negative prompt is embedded.
 */
export function buildImagePrompt(graph: ArchitectureGraph): {
  prompt: string;
  negativePrompt: string;
} {
  const { project, summary, nodes } = graph;

  if (nodes.length === 0) {
    const basePrompt = `Hardware: "${project}". ${summary}`;
    return {
      prompt: `${basePrompt}\n\nNegative: ${NEGATIVE_PROMPT}`.slice(0, 2048),
      negativePrompt: NEGATIVE_PROMPT,
    };
  }

  const grouped = groupComponents(nodes);
  
  // Compact component lines: count, name, part number only (no descriptions to save space)
  const componentLines = grouped.map((comp) => {
    const prefix = comp.count > 1 ? `${comp.count}× ` : '';
    const partRef = comp.partNumber ? ` (${comp.partNumber})` : '';
    return `${prefix}${comp.name}${partRef}`;
  });

  const typeHint = graph.nodes[0]?.type || 'general';
  const materialHint = buildMaterialsBlock(nodes).slice(0, 1).join(' ');
  const arrangementHint = buildArrangementBlock(nodes).split('.')[0]; // First sentence only

  // Ultra-compact prompt: fits in 2048 chars with negative prompt embedded
  const basePrompt = `Render: ${typeHint} assembly "${project}". ${summary}
Components: ${componentLines.join(', ')}
Materials: ${materialHint}
Layout: ${arrangementHint}
Camera: 3/4 view, 22° elevation, 35mm, eye-level
Lighting: 3-point product photography, soft shadows, grey cyclorama
Quality: PBR, 8K, micro-details, real hardware look`;

  // Embed negative prompt directly in the message
  const prompt = `${basePrompt}\n\nNegative: ${NEGATIVE_PROMPT}`;

  // Ensure full prompt fits Cloudflare 2048 limit
  const truncatedPrompt = prompt.slice(0, 2048);

  return {
    prompt: truncatedPrompt,
    negativePrompt: NEGATIVE_PROMPT,
  };
}

const NEGATIVE_PROMPT = `no text, no logos, no people, no diagrams, no clay render, no blur`;

/**
 * Compute a stable cache key from the graph.
 * SHA-256 hash of (nodes + connections) as canonical JSON.
 */
export async function computeGraphHash(graph: ArchitectureGraph): Promise<string> {
  const canonical = JSON.stringify({
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      partNumber: n.partNumber,
      description: n.description,
      ports: n.ports,
    })),
    connections: graph.connections.map((c) => ({
      id: c.id,
      from: c.from,
      to: c.to,
      kind: c.kind,
    })),
  });

  // Use SubtleCrypto if available (Node.js 15+), else fall back to crypto module
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for older Node.js or when subtle crypto unavailable
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
