import React, { useState, useEffect, useRef } from 'react';
import type { 
  AgenticEvent, 
  ErrorContext, 
  StageProgress, 
  ConnectionHealth,
  ValidationReport 
} from '../types/build';

interface DebugConsoleProps {
  isOpen: boolean;
  onToggle: () => void;
  events: AgenticEvent[];
  errorContexts: ErrorContext[];
  stageProgress: Map<string, StageProgress>;
  connectionHealth?: ConnectionHealth;
  reports: Partial<Record<'firmware' | 'software' | 'consistency', ValidationReport>>;
}

interface DebugFilter {
  showHeartbeats: boolean;
  showCommands: boolean;
  showSubsteps: boolean;
  showErrors: boolean;
  showWarnings: boolean;
  showInfo: boolean;
  stageFilter: string;
  searchTerm: string;
}

export function DebugConsole({ 
  isOpen, 
  onToggle, 
  events, 
  errorContexts, 
  stageProgress, 
  connectionHealth,
  reports 
}: DebugConsoleProps) {
  const [activeTab, setActiveTab] = useState<'events' | 'errors' | 'performance' | 'raw'>('events');
  const [filter, setFilter] = useState<DebugFilter>({
    showHeartbeats: false,
    showCommands: true,
    showSubsteps: true,
    showErrors: true,
    showWarnings: true,
    showInfo: false,
    stageFilter: 'all',
    searchTerm: '',
  });
  const [autoScroll, setAutoScroll] = useState(true);
  
  const consoleRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && isAtBottom && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [events, autoScroll, isAtBottom]);

  // Track if user is at bottom of console
  const handleScroll = () => {
    if (consoleRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 5;
      setIsAtBottom(atBottom);
    }
  };

  const filteredEvents = events.filter(event => {
    // Filter by event type
    if (!filter.showHeartbeats && event.type === 'heartbeat') return false;
    if (!filter.showCommands && (event.type === 'command' || event.type === 'command_result')) return false;
    if (!filter.showSubsteps && event.type === 'substep') return false;
    
    // Filter by severity
    if (event.type === 'log') {
      const tone = event.tone || 'info';
      if (!filter.showErrors && tone === 'error') return false;
      if (!filter.showWarnings && tone === 'warn') return false;
      if (!filter.showInfo && tone === 'info') return false;
    }
    
    // Filter by stage
    if (filter.stageFilter !== 'all' && 'stage' in event && event.stage !== filter.stageFilter) return false;
    
    // Search term
    if (filter.searchTerm) {
      const searchLower = filter.searchTerm.toLowerCase();
      const eventText = JSON.stringify(event).toLowerCase();
      if (!eventText.includes(searchLower)) return false;
    }
    
    return true;
  });

  const stages = Array.from(new Set(events.map(e => 'stage' in e ? e.stage : '').filter(Boolean)));

  if (!isOpen) {
    return (
      <button 
        className="debug-console-toggle closed"
        onClick={onToggle}
        title="Open Debug Console"
      >
        🔧 Debug Console
      </button>
    );
  }

  return (
    <div className="debug-console-overlay">
      <div className="debug-console">
        <div className="debug-console-header">
          <div className="debug-console-tabs">
            <button 
              className={`debug-tab ${activeTab === 'events' ? 'active' : ''}`}
              onClick={() => setActiveTab('events')}
            >
              📋 Events ({filteredEvents.length})
            </button>
            <button 
              className={`debug-tab ${activeTab === 'errors' ? 'active' : ''}`}
              onClick={() => setActiveTab('errors')}
            >
              🚨 Errors ({errorContexts.length})
            </button>
            <button 
              className={`debug-tab ${activeTab === 'performance' ? 'active' : ''}`}
              onClick={() => setActiveTab('performance')}
            >
              📊 Performance
            </button>
            <button 
              className={`debug-tab ${activeTab === 'raw' ? 'active' : ''}`}
              onClick={() => setActiveTab('raw')}
            >
              🔍 Raw Data
            </button>
          </div>
          
          <div className="debug-console-controls">
            {connectionHealth && (
              <div className={`connection-indicator ${connectionHealth.connected ? 'connected' : 'disconnected'}`}>
                <span className="status-dot" />
                {connectionHealth.connected ? 'Connected' : 'Disconnected'}
                {connectionHealth.latencyMs && (
                  <span className="latency">{connectionHealth.latencyMs}ms</span>
                )}
              </div>
            )}
            
            <button 
              className="debug-console-close"
              onClick={onToggle}
              title="Close Debug Console"
            >
              ✕
            </button>
          </div>
        </div>

        {activeTab === 'events' && (
          <>
            <div className="debug-console-filters">
              <div className="filter-group">
                <label>
                  <input
                    type="checkbox"
                    checked={filter.showCommands}
                    onChange={(e) => setFilter(f => ({ ...f, showCommands: e.target.checked }))}
                  />
                  Commands
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={filter.showSubsteps}
                    onChange={(e) => setFilter(f => ({ ...f, showSubsteps: e.target.checked }))}
                  />
                  Substeps
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={filter.showErrors}
                    onChange={(e) => setFilter(f => ({ ...f, showErrors: e.target.checked }))}
                  />
                  Errors
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={filter.showWarnings}
                    onChange={(e) => setFilter(f => ({ ...f, showWarnings: e.target.checked }))}
                  />
                  Warnings
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={filter.showInfo}
                    onChange={(e) => setFilter(f => ({ ...f, showInfo: e.target.checked }))}
                  />
                  Info
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={filter.showHeartbeats}
                    onChange={(e) => setFilter(f => ({ ...f, showHeartbeats: e.target.checked }))}
                  />
                  Heartbeats
                </label>
              </div>
              
              <div className="filter-group">
                <select 
                  value={filter.stageFilter} 
                  onChange={(e) => setFilter(f => ({ ...f, stageFilter: e.target.value }))}
                >
                  <option value="all">All Stages</option>
                  {stages.map(stage => (
                    <option key={stage} value={stage}>{stage}</option>
                  ))}
                </select>
                
                <input
                  type="text"
                  placeholder="Search events..."
                  value={filter.searchTerm}
                  onChange={(e) => setFilter(f => ({ ...f, searchTerm: e.target.value }))}
                />
                
                <label>
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  Auto-scroll
                </label>
              </div>
            </div>

            <div 
              className="debug-console-content events"
              ref={consoleRef}
              onScroll={handleScroll}
            >
              {filteredEvents.map((event, index) => (
                <EventRow key={index} event={event} />
              ))}
              
              {!isAtBottom && (
                <button 
                  className="scroll-to-bottom"
                  onClick={() => {
                    if (consoleRef.current) {
                      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
                    }
                  }}
                >
                  ↓ Scroll to Bottom
                </button>
              )}
            </div>
          </>
        )}

        {activeTab === 'errors' && (
          <div className="debug-console-content errors">
            {errorContexts.length === 0 ? (
              <div className="no-errors">No errors detected</div>
            ) : (
              errorContexts.map(error => (
                <ErrorRow key={error.id} error={error} />
              ))
            )}
          </div>
        )}

        {activeTab === 'performance' && (
          <div className="debug-console-content performance">
            <PerformanceView 
              stageProgress={stageProgress} 
              reports={reports}
            />
          </div>
        )}

        {activeTab === 'raw' && (
          <div className="debug-console-content raw">
            <div className="raw-data-section">
              <h4>Recent Events (Last 10)</h4>
              <pre>{JSON.stringify(events.slice(-10), null, 2)}</pre>
            </div>
            
            <div className="raw-data-section">
              <h4>Error Contexts</h4>
              <pre>{JSON.stringify(errorContexts.slice(-5), null, 2)}</pre>
            </div>
            
            <div className="raw-data-section">
              <h4>Stage Progress</h4>
              <pre>{JSON.stringify(Array.from(stageProgress.entries()), null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: AgenticEvent }) {
  const [expanded, setExpanded] = useState(false);
  
  const getEventIcon = (event: AgenticEvent): string => {
    switch (event.type) {
      case 'stage': return '🎯';
      case 'stage_progress': return '📊';
      case 'substep': return '📋';
      case 'heartbeat': return '💓';
      case 'command': return '⚡';
      case 'command_result': return event.exitCode === 0 ? '✅' : '❌';
      case 'log': return event.tone === 'error' ? '🚨' : event.tone === 'warn' ? '⚠️' : 'ℹ️';
      case 'error_context': return '🔥';
      case 'validation': return event.report.ok ? '✅' : '❌';
      case 'operation_start': return '🚀';
      case 'operation_complete': return event.status === 'completed' ? '🎉' : '💥';
      default: return '📝';
    }
  };

  const formatTime = (timestamp?: number) => {
    const time = timestamp || Date.now();
    return new Date(time).toLocaleTimeString();
  };

  const getEventSummary = (event: AgenticEvent): string => {
    switch (event.type) {
      case 'stage': return `Stage: ${event.title}`;
      case 'command': return `Command: ${event.cmd}`;
      case 'command_result': return `Result: ${event.cmd} (exit ${event.exitCode})`;
      case 'log': return event.line;
      case 'substep': return `Substep: ${event.substep.title} (${event.substep.status})`;
      case 'validation': return `Validation: ${event.report.target} (${event.report.ok ? 'OK' : 'Failed'})`;
      case 'heartbeat': return `Heartbeat (${formatTime(event.timestamp)})`;
      default: return JSON.stringify(event);
    }
  };

  return (
    <div className={`event-row ${event.type}`}>
      <div className="event-summary" onClick={() => setExpanded(!expanded)}>
        <span className="event-icon">{getEventIcon(event)}</span>
        <span className="event-time">{formatTime()}</span>
        <span className="event-type">{event.type}</span>
        <span className="event-text">{getEventSummary(event)}</span>
        <span className="expand-toggle">{expanded ? '▼' : '▶'}</span>
      </div>
      
      {expanded && (
        <div className="event-details">
          <pre>{JSON.stringify(event, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function ErrorRow({ error }: { error: ErrorContext }) {
  return (
    <div className={`error-row ${error.severity}`}>
      <div className="error-header">
        <span className="error-icon">
          {error.severity === 'error' ? '🚨' : error.severity === 'warning' ? '⚠️' : 'ℹ️'}
        </span>
        <span className="error-time">
          {new Date(error.timestamp).toLocaleTimeString()}
        </span>
        <span className="error-stage">{error.stage}</span>
        <span className="error-code">{error.code}</span>
      </div>
      
      <div className="error-content">
        <div className="error-message">{error.message}</div>
        
        {error.file && (
          <div className="error-location">
            📁 {error.file}{error.line && `:${error.line}`}
          </div>
        )}
        
        {error.suggestion && (
          <div className="error-suggestion">
            💡 {error.suggestion}
          </div>
        )}
        
        {error.details && (
          <details className="error-details">
            <summary>Details</summary>
            <pre>{error.details}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

function PerformanceView({ 
  stageProgress, 
  reports 
}: { 
  stageProgress: Map<string, StageProgress>;
  reports: Partial<Record<'firmware' | 'software' | 'consistency', ValidationReport>>;
}) {
  const stages = Array.from(stageProgress.values());
  
  const getStageDuration = (stage: StageProgress): number => {
    if (stage.completedAt) {
      return stage.completedAt - stage.startedAt;
    }
    return Date.now() - stage.startedAt;
  };

  const totalDuration = stages.reduce((total, stage) => total + getStageDuration(stage), 0);

  return (
    <div className="performance-view">
      <div className="performance-summary">
        <div className="performance-metric">
          <span className="metric-label">Total Duration</span>
          <span className="metric-value">{Math.round(totalDuration / 1000)}s</span>
        </div>
        
        <div className="performance-metric">
          <span className="metric-label">Active Stages</span>
          <span className="metric-value">
            {stages.filter(s => s.status === 'running').length}
          </span>
        </div>
        
        <div className="performance-metric">
          <span className="metric-label">Completed Stages</span>
          <span className="metric-value">
            {stages.filter(s => s.status === 'completed').length}/{stages.length}
          </span>
        </div>
      </div>

      <div className="stage-timings">
        <h4>Stage Performance</h4>
        {stages.map(stage => (
          <div key={stage.stage} className="stage-timing">
            <div className="stage-timing-header">
              <span className="stage-name">{stage.title}</span>
              <span className="stage-duration">
                {Math.round(getStageDuration(stage) / 1000)}s
                {stage.estimatedDurationMs && (
                  <span className="estimated">
                    / ~{Math.round(stage.estimatedDurationMs / 1000)}s
                  </span>
                )}
              </span>
            </div>
            
            <div className="substep-timings">
              {stage.substeps.map(substep => (
                <div key={substep.id} className="substep-timing">
                  <span className="substep-name">{substep.title}</span>
                  <span className="substep-duration">
                    {substep.completedAt && substep.startedAt && (
                      `${substep.completedAt - substep.startedAt}ms`
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="validation-performance">
        <h4>Validation Reports</h4>
        {Object.entries(reports).map(([key, report]) => (
          <div key={key} className="validation-report">
            <div className="report-header">
              <span className="report-name">{key}</span>
              <span className="report-duration">{report.durationMs}ms</span>
              <span className={`report-status ${report.ok ? 'ok' : 'failed'}`}>
                {report.ok ? '✅' : '❌'}
              </span>
            </div>
            
            <div className="report-commands">
              {report.commands.map((cmd, index) => (
                <div key={index} className="command-timing">
                  <span className="command-name">{cmd.cmd}</span>
                  <span className="command-duration">{cmd.durationMs}ms</span>
                  <span className={`command-status ${cmd.exitCode === 0 ? 'ok' : 'failed'}`}>
                    exit {cmd.exitCode}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}