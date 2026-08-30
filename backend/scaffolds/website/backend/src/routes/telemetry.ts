import { Router } from 'express';
import { controlEndpoints, readEndpoints } from '../config/deviceEndpoints.js';
import {
  getDeviceInfo,
  getLiveReadings,
  sendControl,
} from '../services/deviceClient.js';
import { getHistory, recordReadings } from '../services/historyStore.js';

/**
 * Telemetry + control API for the device dashboard.
 *
 * - /live  — always proxies the device right now (never stale).
 * - /history — readings the backend has captured (Mongo or memory).
 * - /control — dispatch a command to an actuator endpoint.
 * - /capabilities — the read/control endpoint manifest (drives the UI).
 */
const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'device-dashboard-backend' });
});

router.get('/device/info', async (_req, res) => {
  try {
    res.json(await getDeviceInfo());
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'device unreachable' });
  }
});

router.get('/capabilities', (_req, res) => {
  res.json({
    reads: readEndpoints(),
    controls: controlEndpoints(),
  });
});

router.get('/telemetry/live', async (_req, res) => {
  try {
    const readings = await getLiveReadings();
    const now = new Date();
    // Opportunistically persist for history; never fail the response on it.
    await recordReadings(
      Object.entries(readings).map(([metric, value]) => ({
        device: 'wireup-device',
        metric,
        value,
        unit: readEndpoints().find((entry) => entry.id === metric)?.unit ?? '',
        createdAt: now,
      })),
    );
    res.json({ ts: now.toISOString(), ...readings });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'device unreachable' });
  }
});

router.get('/telemetry/history', async (req, res) => {
  const metric = typeof req.query.metric === 'string' ? req.query.metric : undefined;
  const limitRaw = Number(req.query.limit ?? 200);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : 200;
  res.json({ metric: metric ?? null, readings: await getHistory(metric, limit) });
});

router.post('/telemetry/control', async (req, res) => {
  const endpointId = String(req.body?.endpoint ?? '');
  const payload = req.body?.payload;
  try {
    const result = await sendControl(endpointId, payload);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'command failed' });
  }
});

export default router;
