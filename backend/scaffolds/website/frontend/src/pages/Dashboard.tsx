import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, deviceSpec, metricValue } from '../api/client';
import { usePolling } from '../lib/usePolling';
import { statusTone } from '../lib/format';
import MetricCard from '../components/MetricCard';
import ControlPanel from '../components/ControlPanel';

export default function Dashboard() {
  const [notice, setNotice] = useState<string | null>(null);
  const { data: live, error, loading } = usePolling(
    () => api.live(),
    deviceSpec.refreshMs,
    [],
  );

  const status = live ? metricValue(live, deviceSpec.statusPath) : undefined;
  const tone = statusTone(status);

  const cards = useMemo(
    () =>
      deviceSpec.metrics.map((metric) => (
        <MetricCard
          key={metric.id}
          metric={metric}
          value={live ? metricValue(live, metric.path) : undefined}
        />
      )),
    [live],
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{deviceSpec.name}</h1>
          <p className="muted">{deviceSpec.tagline}</p>
        </div>
        <div className={`badge badge-${tone}`}>
          {loading && !live ? 'Connecting…' : status === undefined ? 'Status unknown' : String(status)}
        </div>
      </header>

      {error && (
        <div className="alert">
          <strong>Device unreachable.</strong> {error}. Verify the backend can
          reach the device on your network.
        </div>
      )}

      <div className="metric-grid">{cards}</div>

      <div className="layout-row">
        <ControlPanel controls={deviceSpec.controls} onSent={setNotice} />
        <div className="card">
          <h3>History</h3>
          <p className="muted">
            View captured readings over time for each sensor.
          </p>
          <Link className="link" to="/history">
            Open history →
          </Link>
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}
