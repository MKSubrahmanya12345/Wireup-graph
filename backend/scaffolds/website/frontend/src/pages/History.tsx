import { useMemo, useState } from 'react';

import { api, deviceSpec } from '../api/client';
import { usePolling } from '../lib/usePolling';
import { formatTime, formatValue } from '../lib/format';

export default function History() {
  const [metricId, setMetricId] = useState<string>(deviceSpec.metrics[0]?.id ?? '');
  const metric = deviceSpec.metrics.find((entry) => entry.id === metricId);
  const { data, error, loading } = usePolling(
    () => api.history(metricId || undefined, 300),
    5000,
    [metricId],
  );

  const rows = useMemo(() => data?.readings ?? [], [data]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>History</h1>
          <p className="muted">Captured readings over time.</p>
        </div>
        <select
          className="select"
          value={metricId}
          onChange={(event) => setMetricId(event.target.value)}
        >
          {deviceSpec.metrics.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
          {deviceSpec.metrics.length === 0 && <option value="">No metrics</option>}
        </select>
      </header>

      {error && <div className="alert">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Metric</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3}>{loading ? 'Loading…' : 'No readings captured yet.'}</td>
              </tr>
            ) : (
              rows.map((reading, index) => (
                <tr key={index}>
                  <td>{formatTime(reading.createdAt)}</td>
                  <td>{metric?.label ?? reading.metric}</td>
                  <td>{formatValue(reading.value, reading.unit ?? '')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
