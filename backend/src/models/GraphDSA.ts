/**
 * Graph DSA — the verified architecture data store.
 *
 * Stores the complete verified architecture graph, validation history,
 * RAG-retrieved evidence, and a "perfect" status flag. Used as a PRD
 * for agentic coding agents.
 */
import mongoose, { type Model, type Types } from 'mongoose';

const { Schema, model, models } = mongoose;

export interface DSAEvidenceRecord {
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string;
  retrievedAt: Date;
  contentSnippet: string;
  relevanceScore: number;
}

export interface DSADoubtRecord {
  id: string;
  prompt: string;
  whyMaterial: string;
  impact: string;
  kind: 'single' | 'multi' | 'number' | 'boolean';
  options: { value: string; label: string; hint?: string }[];
  defaultValue: string;
  resolved: boolean;
  resolution?: string;
  resolvedAt?: Date;
}

export interface DSAValidationLoopRecord {
  loopId: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'in_progress' | 'perfect' | 'blocked';
  doubtsAsked: number;
  doubtsResolved: number;
  validationIssues: string[]; // issue ids
  ragEvidenceIds: string[];
  notes: string[];
}

export interface GraphDSADoc {
  _id: Types.ObjectId;
  projectName: string;
  summary: string;
  // The canonical architecture graph
  architectureGraph: Record<string, unknown>;
  // Verification report from architecture service
  verification: Record<string, unknown> | null;
  // Engineering issues found during validation
  engineeringIssues: Record<string, unknown>[];
  // RAG-retrieved evidence from component catalog / rules / sources
  ragEvidence: DSAEvidenceRecord[];
  // Validation loop history
  validationLoops: DSAValidationLoopRecord[];
  // Doubts asked to user
  doubts: DSADoubtRecord[];
  // Whether project data is considered "perfect"
  isPerfect: boolean;
  // The complete verified data ready for agentic coding
  prdDocument: Record<string, unknown>;
  // References to external sources
  componentSources: { title: string; url: string; usedFor: string }[];
  createdAt: Date;
  updatedAt: Date;
}

const evidenceSchema = new Schema<DSAEvidenceRecord>(
  {
    sourceId: { type: String, required: true },
    sourceTitle: { type: String, required: true },
    sourceUrl: { type: String, required: true },
    retrievedAt: { type: Date, default: () => new Date() },
    contentSnippet: { type: String, default: '' },
    relevanceScore: { type: Number, default: 0 },
  },
  { _id: false },
);

const doubtSchema = new Schema<DSADoubtRecord>(
  {
    id: { type: String, required: true },
    prompt: { type: String, required: true },
    whyMaterial: { type: String, default: '' },
    impact: { type: String, default: '' },
    kind: { type: String, enum: ['single', 'multi', 'number', 'boolean'], default: 'single' },
    options: {
      type: [{ value: String, label: String, hint: String }],
      default: [],
    },
    defaultValue: { type: String, default: '' },
    resolved: { type: Boolean, default: false },
    resolution: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { _id: false },
);

const loopSchema = new Schema<DSAValidationLoopRecord>(
  {
    loopId: { type: String, required: true },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date, default: null },
    status: { type: String, enum: ['in_progress', 'perfect', 'blocked'], default: 'in_progress' },
    doubtsAsked: { type: Number, default: 0 },
    doubtsResolved: { type: Number, default: 0 },
    validationIssues: { type: [String], default: [] },
    ragEvidenceIds: { type: [String], default: [] },
    notes: { type: [String], default: [] },
  },
  { _id: false },
);

const graphDSASchema = new Schema<GraphDSADoc>(
  {
    projectName: { type: String, required: true, trim: true, maxlength: 200 },
    summary: { type: String, default: '', maxlength: 1000 },
    architectureGraph: { type: Schema.Types.Mixed, default: {} },
    verification: { type: Schema.Types.Mixed, default: null },
    // Cast needed: mongoose's generic schema typing is strict about Mixed arrays.
    engineeringIssues: {
      type: [Schema.Types.Mixed] as unknown as typeof Schema.Types.Mixed,
      default: [],
    },
    ragEvidence: { type: [evidenceSchema], default: [] },
    validationLoops: { type: [loopSchema], default: [] },
    doubts: { type: [doubtSchema], default: [] },
    isPerfect: { type: Boolean, default: false },
    prdDocument: { type: Schema.Types.Mixed, default: {} },
    componentSources: {
      type: [{ title: String, url: String, usedFor: String }],
      default: [],
    },
  },
  { timestamps: true },
);

graphDSASchema.index({ updatedAt: -1 });
graphDSASchema.index({ isPerfect: 1, updatedAt: -1 });
graphDSASchema.index({ projectName: 1 });

// Expose `id` instead of `_id` so the frontend never deals in ObjectIds.
graphDSASchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    const out = ret as unknown as Record<string, unknown>;
    out.id = String(out._id);
    delete out._id;
    return out;
  },
});

export const GraphDSA: Model<GraphDSADoc> =
  (models.GraphDSA as Model<GraphDSADoc>) ?? model<GraphDSADoc>('GraphDSA', graphDSASchema);
