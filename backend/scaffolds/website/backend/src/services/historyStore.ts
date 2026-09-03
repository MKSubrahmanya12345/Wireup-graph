import mongoose from 'mongoose';
import {
  MemoryReservoir,
  ReadingModel,
  type ReadingDoc,
} from '../models/Reading.js';

/**
 * Read/write historical readings against Mongo when connected, otherwise the
 * in-memory reservoir. The connection status is checked lazily so a Mongo
 * outage degrades to memory instead of throwing.
 */

const memory = new MemoryReservoir(1000);

export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

function mongo(): mongoose.Connection {
  return mongoose.connection;
}

export async function recordReadings(
  readings: Omit<ReadingDoc, 'createdAt'>[],
): Promise<void> {
  if (!isMongoConnected()) {
    for (const reading of readings) {
      memory.push({ ...reading, createdAt: new Date() });
    }
    return;
  }
  await ReadingModel.insertMany(
    readings.map((reading) => ({ ...reading, createdAt: new Date() })),
  );
}

export async function getHistory(
  metric?: string,
  limit = 200,
): Promise<ReadingDoc[]> {
  if (!isMongoConnected()) return memory.all(metric, limit);
  const query = mongo()
    .collection('readings')
    .find(metric ? { metric } : {})
    .sort({ createdAt: -1 })
    .limit(limit);
  const rows = await query.toArray();
  return rows.map((row: any) => ({
    device: String(row.device ?? ''),
    metric: String(row.metric ?? ''),
    value: row.value,
    unit: row.unit ? String(row.unit) : '',
    createdAt: new Date(row.createdAt),
  }));
}
