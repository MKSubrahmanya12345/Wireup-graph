import mongoose, { Schema } from 'mongoose';

/**
 * Optional history store. When MONGO_URI is unset the API runs fully in
 * memory (historyReservoir), so Mongo is never a hard requirement.
 */
const readingSchema = new Schema(
  {
    device: { type: String, required: true, default: 'wireup-device' },
    metric: { type: String, required: true }, // e.g. "temperature"
    value: { type: Schema.Types.Mixed, required: true },
    unit: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
readingSchema.index({ device: 1, metric: 1, createdAt: -1 });

export interface ReadingDoc {
  device: string;
  metric: string;
  value: unknown;
  unit?: string;
  createdAt: Date;
}

export const ReadingModel =
  mongoose.models.Reading ?? mongoose.model('Reading', readingSchema);

/**
 * Ring-buffer fallback so the app works with zero configuration. Callers use
 * this when Mongoose is not connected.
 */
export class MemoryReservoir {
  private readonly max: number;
  private items: ReadingDoc[] = [];

  constructor(max = 1000) {
    this.max = max;
  }

  push(reading: ReadingDoc): void {
    this.items.push(reading);
    if (this.items.length > this.max) {
      this.items = this.items.slice(-this.max);
    }
  }

  all(metric?: string, limit = 200): ReadingDoc[] {
    const filtered = metric
      ? this.items.filter((item) => item.metric === metric)
      : this.items;
    return filtered.slice(-limit);
  }
}
