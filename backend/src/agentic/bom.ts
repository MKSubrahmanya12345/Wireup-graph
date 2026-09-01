import { DEVICE_KNOWLEDGE, withAffiliateTag } from './knowledge/devices.js';
import type { DeviceBuildPlan } from './types.js';

/**
 * Bill of materials for a resolved build plan, with purchase links.
 *
 * The links come from the knowledge base (`purchase` on each device) and get
 * the configured affiliate tag applied at render time — so a tag change is a
 * one-line env change, not a data migration.
 */

export interface BomLink {
  vendor: string;
  url: string;
  note?: string;
}

export interface BomEntry {
  ref: string;
  name: string;
  partNumber: string;
  quantity: number;
  role: string;
  /** Where this part connects, e.g. "data → GPIO4". */
  connections: string;
  approxPricePaise: number;
  datasheet?: string;
  links: BomLink[];
}

export interface Bom {
  entries: BomEntry[];
  totalApproxPaise: number;
  currency: 'INR';
  /** True when at least one part has no price in the knowledge base. */
  incomplete: boolean;
}

export function buildBom(plan: DeviceBuildPlan): Bom {
  const entries: BomEntry[] = [];

  // 1. The board itself.
  entries.push({
    ref: 'U1',
    name: plan.board.name,
    partNumber: plan.board.mcu,
    quantity: 1,
    role: 'microcontroller',
    connections: `${plan.board.voltage} V logic · ${plan.board.wifi ? 'Wi-Fi on board' : 'no radio'}`,
    approxPricePaise: 0,
    links: [
      {
        vendor: 'Amazon',
        url: withAffiliateTag({ vendor: 'Amazon', url: `https://www.amazon.in/s?k=${encodeURIComponent(plan.board.name)}` }),
        note: 'fastest delivery in India',
      },
      {
        vendor: 'Robu',
        url: withAffiliateTag({ vendor: 'Robu', url: `https://robu.in/?s=${encodeURIComponent(plan.board.name)}` }),
        note: 'hobby-electronics specialist',
      },
    ],
  });

  // 2. One entry per resolved module, in plan order.
  plan.modules.forEach((module, index) => {
    const knowledge = DEVICE_KNOWLEDGE.find((device) => device.id === module.deviceId);
    entries.push({
      ref: `M${index + 1}`,
      name: module.name,
      partNumber: module.partNumber,
      quantity: 1,
      role: module.kind,
      connections:
        Object.entries(module.pins)
          .map(([role, pin]) => `${role} → ${pin}`)
          .join(', ') || 'power only',
      approxPricePaise: knowledge?.approxPricePaise ?? 0,
      datasheet: knowledge?.datasheet,
      links: (knowledge?.purchase ?? []).map((link) => ({
        vendor: link.vendor,
        url: withAffiliateTag(link),
        note: link.note,
      })),
    });
  });

  // 3. Passives the wiring notes call for (pull-ups etc.).
  const needsPullup = plan.modules.some((module) =>
    module.wiringNotes.some((note) => /pull-?up/i.test(note)),
  );
  if (needsPullup) {
    entries.push({
      ref: 'R1',
      name: '10 kΩ resistor (data-line pull-up)',
      partNumber: 'RES-10K-0.25W',
      quantity: 1,
      role: 'passive',
      connections: 'DATA ↔ 3V3',
      approxPricePaise: 500,
      links: [
        {
          vendor: 'Amazon',
          url: withAffiliateTag({ vendor: 'Amazon', url: 'https://www.amazon.in/s?k=10k+ohm+resistor+kit' }),
        },
      ],
    });
  }

  const totalApproxPaise = entries.reduce((sum, entry) => sum + entry.approxPricePaise * entry.quantity, 0);
  return {
    entries,
    totalApproxPaise,
    currency: 'INR',
    incomplete: entries.some((entry) => entry.approxPricePaise === 0),
  };
}
