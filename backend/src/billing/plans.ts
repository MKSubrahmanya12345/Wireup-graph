/**
 * Wireup plans.
 *
 * [BLOCKED — NEEDS HUMAN: pricing] Every paid amount below is a ₹0
 * placeholder. Nothing in the code depends on the number being right: set
 * `amountPaise` here (or override with PLAN_PRO_PAISE etc. later) and the
 * checkout, revenue reporting and admin panel all follow.
 */

export type PlanId = 'free' | 'pro';

export interface Plan {
  id: PlanId;
  name: string;
  /** Smallest currency unit. 0 = placeholder pending a human pricing call. */
  amountPaise: number;
  currency: 'INR';
  /** Which LLM tier a build on this plan is entitled to. */
  llmTier: 'groq' | 'gemini';
  features: string[];
  /** True while the price is still a placeholder. Surfaced in the UI. */
  pricingPending: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    amountPaise: 0,
    currency: 'INR',
    llmTier: 'groq',
    features: [
      'Deterministic knowledge-base engine',
      'Groq-assisted firmware drafts',
      'g++ / npm / tsc / vite validation gates',
      'Mock hardware simulation',
    ],
    pricingPending: false,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    // [BLOCKED — NEEDS HUMAN: pricing]
    amountPaise: 0,
    currency: 'INR',
    llmTier: 'gemini',
    features: [
      'Everything in Free',
      'Gemini-tier model on every build (falls back to Groq if the key is absent)',
      'Priority build queue',
      'Per-build instructions + BOM with purchase links',
    ],
    pricingPending: true,
  },
};

export function getPlan(id: string): Plan {
  return PLANS[(id as PlanId) in PLANS ? (id as PlanId) : 'free'];
}

export function listPlans(): Plan[] {
  return Object.values(PLANS);
}
