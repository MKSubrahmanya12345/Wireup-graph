import { useState, useEffect, useRef } from 'react';
import type { AgenticEvent } from '../types/build';

export interface DebugConsoleState {
  isOpen: boolean;
  events: AgenticEvent[];
  recentEvents: AgenticEvent[];
  toggle: () => void;
  addEvent: (event: AgenticEvent) => void;
  clear: () => void;
  exportLogs: () => string;
}

const MAX_EVENTS = 5000;
const MAX_RECENT_EVENTS = 100;

export function useDebugConsole(): DebugConsoleState {
  const [isOpen, setIsOpen] = useState(() => {
    const saved = localStorage.getItem('debug-console-open');
    return saved === 'true';
  });
  
  const [events, setEvents] = useState<AgenticEvent[]>([]);
  const eventBuffer = useRef<AgenticEvent[]>([]);

  // Persist debug console open state
  useEffect(() => {
    localStorage.setItem('debug-console-open', String(isOpen));
  }, [isOpen]);

  const toggle = () => {
    setIsOpen(prev => !prev);
  };

  const addEvent = (event: AgenticEvent) => {
    const timestamp = Date.now();
    const timestampedEvent = { ...event, debugTimestamp: timestamp };

    // Add to buffer first
    eventBuffer.current.push(timestampedEvent);
    
    // Trim buffer if it gets too large
    if (eventBuffer.current.length > MAX_EVENTS) {
      eventBuffer.current = eventBuffer.current.slice(-MAX_EVENTS);
    }

    // Batch updates for performance - update state every 100ms or when buffer reaches 10 events
    if (eventBuffer.current.length % 10 === 0) {
      flushEventBuffer();
    }
  };

  const flushEventBuffer = () => {
    if (eventBuffer.current.length > 0) {
      setEvents(prev => {
        const combined = [...prev, ...eventBuffer.current];
        eventBuffer.current = [];
        
        // Trim to max events
        return combined.length > MAX_EVENTS 
          ? combined.slice(-MAX_EVENTS)
          : combined;
      });
    }
  };

  // Flush buffer periodically
  useEffect(() => {
    const interval = setInterval(flushEventBuffer, 100);
    return () => clearInterval(interval);
  }, []);

  const clear = () => {
    setEvents([]);
    eventBuffer.current = [];
  };

  const exportLogs = () => {
    const logData = {
      timestamp: new Date().toISOString(),
      totalEvents: events.length,
      events: events.map(event => ({
        ...event,
        exportTimestamp: new Date().toISOString()
      }))
    };
    
    return JSON.stringify(logData, null, 2);
  };

  const recentEvents = events.slice(-MAX_RECENT_EVENTS);

  return {
    isOpen,
    events,
    recentEvents,
    toggle,
    addEvent,
    clear,
    exportLogs,
  };
}

// Hook to collect performance metrics
export function usePerformanceMetrics() {
  const [metrics, setMetrics] = useState({
    memoryUsage: 0,
    eventRate: 0,
    averageLatency: 0,
    connectionQuality: 'good' as 'good' | 'fair' | 'poor',
  });

  useEffect(() => {
    let eventCount = 0;
    let lastEventTime = Date.now();
    
    const updateMetrics = () => {
      // Memory usage (approximation)
      if ('memory' in performance) {
        const memory = (performance as any).memory;
        setMetrics(prev => ({
          ...prev,
          memoryUsage: Math.round(memory.usedJSHeapSize / 1024 / 1024) // MB
        }));
      }

      // Event rate calculation
      const now = Date.now();
      const timeDiff = now - lastEventTime;
      const rate = eventCount / (timeDiff / 1000);
      
      setMetrics(prev => ({
        ...prev,
        eventRate: Math.round(rate * 10) / 10, // Events per second
      }));

      eventCount = 0;
      lastEventTime = now;
    };

    const interval = setInterval(updateMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  const recordEvent = () => {
    // Called when an event is processed
    // This would be called from the event handler
  };

  return { metrics, recordEvent };
}

// Hook to monitor build health
export function useBuildHealthMonitor(events: AgenticEvent[]) {
  const [health, setHealth] = useState({
    overall: 'healthy' as 'healthy' | 'warning' | 'critical',
    issues: [] as string[],
    recommendations: [] as string[],
  });

  useEffect(() => {
    const recentEvents = events.slice(-50);
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for error patterns
    const errorEvents = recentEvents.filter(e => 
      e.type === 'error' || 
      (e.type === 'log' && e.tone === 'error') ||
      (e.type === 'command_result' && e.exitCode !== 0)
    );

    if (errorEvents.length > 5) {
      issues.push('High error rate detected');
      recommendations.push('Check build configuration and dependencies');
    }

    // Check for timeouts
    const timeoutEvents = recentEvents.filter(e => 
      e.type === 'log' && 
      e.line && 
      e.line.toLowerCase().includes('timeout')
    );

    if (timeoutEvents.length > 0) {
      issues.push('Timeout issues detected');
      recommendations.push('Check network connectivity and increase timeout values');
    }

    // Check for stuck processes
    const stageEvents = recentEvents.filter(e => e.type === 'stage');
    if (stageEvents.length === 1 && recentEvents.length > 20) {
      issues.push('Build process may be stuck');
      recommendations.push('Consider canceling and restarting the build');
    }

    // Determine overall health
    let overall: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (issues.length > 2) overall = 'critical';
    else if (issues.length > 0) overall = 'warning';

    setHealth({ overall, issues, recommendations });
  }, [events]);

  return health;
}

// Hook for event filtering and search
export function useEventFiltering(events: AgenticEvent[]) {
  const [filters, setFilters] = useState({
    types: [] as string[],
    stages: [] as string[],
    severity: [] as string[],
    timeRange: 'all' as 'all' | '1h' | '30m' | '10m',
    searchTerm: '',
  });

  const filteredEvents = events.filter(event => {
    // Type filter
    if (filters.types.length > 0 && !filters.types.includes(event.type)) {
      return false;
    }

    // Stage filter
    if (filters.stages.length > 0 && 'stage' in event && !filters.stages.includes(event.stage)) {
      return false;
    }

    // Severity filter
    if (filters.severity.length > 0) {
      if (event.type === 'log') {
        const severity = event.tone || 'info';
        if (!filters.severity.includes(severity)) return false;
      } else if (event.type === 'error') {
        if (!filters.severity.includes('error')) return false;
      }
    }

    // Time range filter
    if (filters.timeRange !== 'all') {
      const now = Date.now();
      const timeMs = filters.timeRange === '1h' ? 3600000 : 
                    filters.timeRange === '30m' ? 1800000 : 600000;
      
      const eventTime = (event as any).debugTimestamp || now;
      if (now - eventTime > timeMs) return false;
    }

    // Search term filter
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      const eventStr = JSON.stringify(event).toLowerCase();
      if (!eventStr.includes(searchLower)) return false;
    }

    return true;
  });

  return { filteredEvents, filters, setFilters };
}