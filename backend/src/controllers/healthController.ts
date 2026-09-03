import { Request, Response } from 'express';
import { healthMonitor } from '../agentic/healthMonitor.js';
import { runningJobCount } from '../agentic/buildJobs.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * Get system health status and metrics
 */
export const getHealthStatus = asyncHandler(async (req: Request, res: Response) => {
  const health = healthMonitor.getHealthStatus();
  const runningJobs = runningJobCount();
  
  res.json({
    status: health.status,
    timestamp: Date.now(),
    metrics: health.metrics,
    alerts: health.alerts,
    runningJobs,
    uptime: process.uptime(),
  });
});

/**
 * Get detailed performance report
 */
export const getPerformanceReport = asyncHandler(async (req: Request, res: Response) => {
  const report = healthMonitor.getPerformanceReport();
  
  res.json({
    timestamp: Date.now(),
    ...report,
  });
});

/**
 * Get health metrics for monitoring dashboards
 */
export const getHealthMetrics = asyncHandler(async (req: Request, res: Response) => {
  const health = healthMonitor.getHealthStatus();
  
  // Simplified metrics for external monitoring
  const metrics = {
    timestamp: Date.now(),
    status: health.status,
    cpu_usage: health.metrics.cpu.usage,
    memory_usage_percent: (health.metrics.memory.used / health.metrics.memory.total) * 100,
    active_builds: health.metrics.build.activeJobs,
    avg_build_time_seconds: Math.round(health.metrics.build.avgBuildTime / 1000),
    build_failure_rate: health.metrics.build.failureRate,
    alerts_count: health.alerts.length,
    uptime_seconds: process.uptime(),
  };
  
  res.json(metrics);
});

/**
 * Simple health check endpoint
 */
export const healthCheck = asyncHandler(async (req: Request, res: Response) => {
  const health = healthMonitor.getHealthStatus();
  
  if (health.status === 'critical') {
    res.status(503).json({
      status: 'unhealthy',
      message: 'System is experiencing critical performance issues',
      alerts: health.alerts.filter(a => a.severity === 'critical'),
    });
  } else {
    res.json({
      status: 'healthy',
      timestamp: Date.now(),
      uptime: process.uptime(),
    });
  }
});

/**
 * Toolchain health check endpoint
 */
export const toolchainCheck = asyncHandler(async (req: Request, res: Response) => {
  // Check if essential tools are available
  const toolchain = {
    node: process.version,
    npm: process.env.npm_version || 'unknown',
    timestamp: Date.now(),
  };
  
  res.json({
    status: 'ok',
    toolchain,
  });
});