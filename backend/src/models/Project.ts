import mongoose, { type Model, type Types } from 'mongoose';

// mongoose is CommonJS — destructure off the default export so named imports
// stay resolvable when this file runs as real Node ESM (node dist/server.js).
const { Schema, model, models } = mongoose;

/** Stored as Mixed — the zod schema in schemas/architecture.ts is the contract. */
export interface RevisionDoc {
  /** Assigned by mongoose on push; absent on the object you build by hand. */
  _id?: Types.ObjectId;
  request: string;
  graph: Record<string, unknown>;
  verification: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ProjectDoc {
  _id: Types.ObjectId;
  /** Owning account (auth `sub`). Empty on legacy docs created before accounts. */
  ownerId: string;
  name: string;
  summary: string;
  graph: Record<string, unknown>;
  verification: Record<string, unknown> | null;
  revisions: RevisionDoc[];
  createdAt: Date;
  updatedAt: Date;
}

const revisionSchema = new Schema<RevisionDoc>(
  {
    request: { type: String, required: true },
    graph: { type: Schema.Types.Mixed, default: {} },
    verification: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);

const projectSchema = new Schema<ProjectDoc>(
  {
    // '' marks pre-account legacy docs — claimable by the first session that
    // touches them, so old data never becomes unreachable.
    ownerId: { type: String, default: '', index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    summary: { type: String, default: '', maxlength: 600 },
    graph: { type: Schema.Types.Mixed, default: {} },
    verification: { type: Schema.Types.Mixed, default: null },
    revisions: { type: [revisionSchema], default: [] },
  },
  { timestamps: true },
);

projectSchema.index({ ownerId: 1, updatedAt: -1 });

// Expose `id` instead of `_id` so the frontend never deals in ObjectIds.
projectSchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    const out = ret as unknown as Record<string, unknown>;
    out.id = String(out._id);
    delete out._id;
    return out;
  },
});

export const Project: Model<ProjectDoc> =
  (models.Project as Model<ProjectDoc>) ?? model<ProjectDoc>('Project', projectSchema);