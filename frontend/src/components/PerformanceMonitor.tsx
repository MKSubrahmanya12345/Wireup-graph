import React, { useState, useEffect } from 'react';

interface HealthMetrics {
  status: 'healthy' | 'warning' | 'critical';
  cpu_usage: number;
  memory_usage_percent: number;
  active_builds: number;
  avg_build_time_seconds: number;
  build_failure_rate: number;
  uptime_seconds: number;
  timestamp: number;
}

interface Props {
  isVisible?: boolean;
}

export function PerformanceMonitor({ isVisible = false }: Props) {
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/health/metrics');
      if (!response.ok) throw new Error('Failed to fetch metrics');
      const data = await response.json();
      setMetrics(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isVisible) {
      fetchMetrics();
      const interval = setInterval(fetchMetrics, 10000); // Update every 10 seconds
      return () => clearInterval(interval);
    }
  }, [isVisible]);

  if (!isVisible || !metrics) return null;

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return '#22c55e';
      case 'warning': return '#f59e0b';
      case 'critical': return '#ef4444';
      default: return '#6b7280';
    }
  };

  return (
    <div className="performance-monitor">
      <div className="performance-header">
        <span className="performance-title">System Health</span>
        <span 
          className="performance-status"
          style={{ color: getStatusColor(metrics.status) }}
        >
          ● {metrics.status.toUpperCase()}
        </span>
      </div>

      <div className="performance-grid">
        <div className="metric-card">
          <div className="metric-value">{Math.round(metrics.cpu_usage)}%</div>
          <div className="metric-label">CPU</div>
        </div>

        <div className="metric-card">
          <div className="metric-value">{Math.round(metrics.memory_usage_percent)}%</div>
          <div className="metric-label">Memory</div>
        </div>

        <div className="metric-card">
          <div className="metric-value">{metrics.active_builds}</div>
          <div className="metric-label">Active Builds</div>
        </div>

        <div className="metric-card">
          <div className="metric-value">{metrics.avg_build_time_seconds}s</div>
          <div className="metric-label">Avg Build Time</div>
        </div>
      </div>

      <div className="performance-details">
        <div className="detail-row">
          <span>Failure Rate:</span>
          <span>{Math.round(metrics.build_failure_rate)}%</span>
        </div>
        <div className="detail-row">
          <span>Uptime:</span>
          <span>{formatUptime(metrics.uptime_seconds)}</span>
        </div>
        <div className="detail-row">
          <span>Last Update:</span>
          <span>{new Date(metrics.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>

      {error && (
        <div className="performance-error">
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}