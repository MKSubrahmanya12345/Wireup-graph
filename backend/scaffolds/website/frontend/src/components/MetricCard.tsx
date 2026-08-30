import { formatValue } from '../lib/format';
import type { DeviceMetric } from '../lib/deviceSpec';

interface Props {
  metric: DeviceMetric;
  value: unknown;
}

export default function MetricCard({ metric, value }: Props) {
  return (
    <div className="card metric-card">
      <div className="metric-label">{metric.label}</div>
      <div className="metric-value">{formatValue(value, metric.unit)}</div>
      <div className="metric-id">{metric.id}</div>
    </div>
  );
}
