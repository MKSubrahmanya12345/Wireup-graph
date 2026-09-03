import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { logger } from '../config/logger.js';
import type { BuildEvent } from './types.js';

export interface HealthMetrics {
  timestamp: number;
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    free: number;
    total: number;
    heapUsed: number;
    heapTotal: number;
  };
  build: {
    activeJobs: number;
    totalJobs: number;
    avgBuildTime: number;
    failureRate: number;
  };
  performance: {
    eventLoopDelay: number;
    gcDuration: number;
  };
}

export interface PerformanceAlert {
  severity: 'warning' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: number;
}

class HealthMonitor {
  private metrics: HealthMetrics[] = [];
  private alerts: PerformanceAlert[] = [];
  private buildMetrics = new Map<string, { startTime: number; endTime?: number; success?: boolean }>();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private eventLoopMonitor: any = null;
  
  private thresholds = {
    cpu: { warning: 70, critical: 90 },
    memory: { warning: 80, critical: 95 },
    eventLoopDelay: { warning: 100, critical: 500 }, // ms
    buildTime: { warning: 300000, critical: 600000 }, // 5min warning, 10min critical
  };

  start(emit: (event: BuildEvent) => void): void {
    this.startContinuousMonitoring(emit);
    this.startEventLoopMonitoring();
    this.startGCMonitoring();
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    if (this.eventLoopMonitor) {
      clearInterval(this.eventLoopMonitor);
      this.eventLoopMonitor = null;
    }
  }

  recordBuildStart(jobId: string): void {
    this.buildMetrics.set(jobId, { startTime: Date.now() });
  }

  recordBuildEnd(jobId: string, success: boolean): void {
    const build = this.buildMetrics.get(jobId);
    if (build) {
      build.endTime = Date.now();
      build.success = success;
      
      const duration = build.endTime - build.startTime;
      if (duration > this.thresholds.buildTime.critical) {
        this.addAlert('critical', 'buildTime', duration, this.thresholds.buildTime.critical, 
          `Build ${jobId} took ${Math.round(duration / 1000)}s (critical threshold exceeded)`);
      } else if (duration > this.thresholds.buildTime.warning) {
        this.addAlert('warning', 'buildTime', duration, this.thresholds.buildTime.warning,
          `Build ${jobId} took ${Math.round(duration / 1000)}s (warning threshold exceeded)`);
      }
    }
  }

  recordStagePerformance(stage: string, duration: number, success: boolean): void {
    // Log slow stages
    const stageName = stage.replace(/[-_]/g, ' ');
    if (duration > 60000) { // 1 minute
      logger.warn({ stage, duration, success }, `Slow stage detected: ${stageName} took ${Math.round(duration / 1000)}s`);
    }
  }

  getHealthStatus(): { status: 'healthy' | 'warning' | 'critical'; metrics: HealthMetrics; alerts: PerformanceAlert[] } {
    const currentMetrics = this.collectCurrentMetrics();
    const recentAlerts = this.alerts.filter(a => Date.now() - a.timestamp < 300000); // Last 5 minutes
    
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (recentAlerts.some(a => a.severity === 'critical')) {
      status = 'critical';
    } else if (recentAlerts.some(a => a.severity === 'warning')) {
      status = 'warning';
    }

    return { status, metrics: currentMetrics, alerts: recentAlerts };
  }

  getPerformanceReport(): {
    systemHealth: HealthMetrics;
    buildStats: {
      totalBuilds: number;
      successRate: number;
      avgBuildTime: number;
      slowestBuilds: Array<{ jobId: string; duration: number }>;
    };
    recommendations: string[];
  } {
    const currentMetrics = this.collectCurrentMetrics();
    const completedBuilds = Array.from(this.buildMetrics.entries())
      .filter(([_, build]) => build.endTime !== undefined)
      .map(([jobId, build]) => ({ 
        jobId, 
        duration: build.endTime! - build.startTime, 
        success: build.success! 
      }));

    const successfulBuilds = completedBuilds.filter(b => b.success);
    const avgBuildTime = successfulBuilds.length > 0 
      ? successfulBuilds.reduce((sum, b) => sum + b.duration, 0) / successfulBuilds.length 
      : 0;

    const slowestBuilds = completedBuilds
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5);

    const recommendations = this.generateRecommendations(currentMetrics, completedBuilds);

    return {
      systemHealth: currentMetrics,
      buildStats: {
        totalBuilds: completedBuilds.length,
        successRate: completedBuilds.length > 0 
          ? (successfulBuilds.length / completedBuilds.length) * 100 
          : 0,
        avgBuildTime,
        slowestBuilds,
      },
      recommendations,
    };
  }

  private startContinuousMonitoring(emit: (event: BuildEvent) => void): void {
    this.monitoringInterval = setInterval(() => {
      const metrics = this.collectCurrentMetrics();
      this.metrics.push(metrics);
      
      // Keep only last hour of metrics
      if (this.metrics.length > 720) { // 5s intervals for 1 hour
        this.metrics = this.metrics.slice(-720);
      }

      // Check thresholds and generate alerts
      this.checkThresholds(metrics, emit);
    }, 5000);
  }

  private startEventLoopMonitoring(): void {
    let start = performance.now();
    this.eventLoopMonitor = setInterval(() => {
      const delay = performance.now() - start;
      start = performance.now();
      
      if (delay > this.thresholds.eventLoopDelay.critical) {
        this.addAlert('critical', 'eventLoopDelay', delay, this.thresholds.eventLoopDelay.critical,
          `Event loop delay is ${Math.round(delay)}ms (server may be overloaded)`);
      } else if (delay > this.thresholds.eventLoopDelay.warning) {
        this.addAlert('warning', 'eventLoopDelay', delay, this.thresholds.eventLoopDelay.warning,
          `Event loop delay is ${Math.round(delay)}ms`);
      }
    }, 1000);
  }

  private startGCMonitoring(): void {
    // Monitor garbage collection if available
    if (typeof process !== 'undefined' && process.on) {
      let gcStart = 0;
      
      try {
        const v8 = require('v8');
        v8.setFlagsFromString('--expose-gc');
        
        process.on('gc' as any, (details: any) => {
          const duration = details.duration;
          if (duration > 50) { // GC pauses over 50ms
            logger.warn({ gcType: details.type, duration }, `Long GC pause: ${duration}ms`);
          }
        });
      } catch (e) {
        // GC monitoring not available
      }
    }
  }

  private collectCurrentMetrics(): HealthMetrics {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    const completedBuilds = Array.from(this.buildMetrics.values())
      .filter(b => b.endTime !== undefined);
    const successfulBuilds = completedBuilds.filter(b => b.success);
    const avgBuildTime = successfulBuilds.length > 0
      ? successfulBuilds.reduce((sum, b) => sum + (b.endTime! - b.startTime), 0) / successfulBuilds.length
      : 0;
    
    return {
      timestamp: Date.now(),
      cpu: {
        usage: this.getCpuUsage(),
        loadAverage: os.loadavg(),
      },
      memory: {
        used: usedMem,
        free: freeMem,
        total: totalMem,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      },
      build: {
        activeJobs: Array.from(this.buildMetrics.values()).filter(b => !b.endTime).length,
        totalJobs: this.buildMetrics.size,
        avgBuildTime,
        failureRate: completedBuilds.length > 0 
          ? ((completedBuilds.length - successfulBuilds.length) / completedBuilds.length) * 100 
          : 0,
      },
      performance: {
        eventLoopDelay: 0, // Will be updated by event loop monitor
        gcDuration: 0, // Will be updated by GC monitor
      },
    };
  }

  private getCpuUsage(): number {
    // Simple CPU usage approximation
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });

    return 100 - Math.round((totalIdle / totalTick) * 100);
  }

  private checkThresholds(metrics: HealthMetrics, emit: (event: BuildEvent) => void): void {
    // CPU usage check
    if (metrics.cpu.usage > this.thresholds.cpu.critical) {
      this.addAlert('critical', 'cpu', metrics.cpu.usage, this.thresholds.cpu.critical,
        `CPU usage is ${metrics.cpu.usage}% (critical)`);
    } else if (metrics.cpu.usage > this.thresholds.cpu.warning) {
      this.addAlert('warning', 'cpu', metrics.cpu.usage, this.thresholds.cpu.warning,
        `CPU usage is ${metrics.cpu.usage}%`);
    }

    // Memory usage check
    const memoryUsagePercent = (metrics.memory.used / metrics.memory.total) * 100;
    if (memoryUsagePercent > this.thresholds.memory.critical) {
      this.addAlert('critical', 'memory', memoryUsagePercent, this.thresholds.memory.critical,
        `Memory usage is ${Math.round(memoryUsagePercent)}% (critical)`);
    } else if (memoryUsagePercent > this.thresholds.memory.warning) {
      this.addAlert('warning', 'memory', memoryUsagePercent, this.thresholds.memory.warning,
        `Memory usage is ${Math.round(memoryUsagePercent)}%`);
    }

    // Emit health metrics as events
    emit({
      type: 'log',
      stage: 'health',
      line: `[${new Date().toTimeString().split(' ')[0]}] 🏥 Health: CPU ${metrics.cpu.usage}%, Memory ${Math.round(memoryUsagePercent)}%, Active Jobs ${metrics.build.activeJobs}`,
      tone: 'info',
    });
  }

  private addAlert(severity: 'warning' | 'critical', metric: string, value: number, threshold: number, message: string): void {
    const alert: PerformanceAlert = {
      severity,
      metric,
      value,
      threshold,
      message,
      timestamp: Date.now(),
    };

    this.alerts.push(alert);
    
    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    logger.warn({ alert }, `Performance alert: ${message}`);
  }

  private generateRecommendations(metrics: HealthMetrics, builds: Array<{ duration: number; success: boolean }>): string[] {
    const recommendations: string[] = [];
    
    const memoryUsagePercent = (metrics.memory.used / metrics.memory.total) * 100;
    
    if (memoryUsagePercent > 80) {
      recommendations.push('Consider increasing server memory or optimizing memory usage');
    }
    
    if (metrics.cpu.usage > 80) {
      recommendations.push('High CPU usage detected - consider scaling to more cores');
    }
    
    if (metrics.build.avgBuildTime > 300000) { // 5 minutes
      recommendations.push('Average build time is high - consider caching dependencies or parallel processing');
    }
    
    if (metrics.build.failureRate > 10) {
      recommendations.push('High build failure rate - check error logs and system stability');
    }
    
    const longBuilds = builds.filter(b => b.duration > 600000); // 10 minutes
    if (longBuilds.length > 0) {
      recommendations.push(`${longBuilds.length} builds took over 10 minutes - investigate build bottlenecks`);
    }
    
    if (metrics.build.activeJobs > 3) {
      recommendations.push('Multiple concurrent builds detected - consider queue management');
    }

    return recommendations;
  }
}

// Singleton instance
export const healthMonitor = new HealthMonitor();