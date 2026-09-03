import React from 'react';
import type { StageProgress, ConnectionHealth, ErrorContext } from '../types/build';

interface Props {
  stageProgress?: StageProgress;
  connectionHealth?: ConnectionHealth;
  errorContext?: ErrorContext[];
  isRunning: boolean;
}

export function EnhancedBuildProgress({ stageProgress, connectionHealth, errorContext, isRunning }: Props) {
  if (!stageProgress && !isRunning) return null;

  return (
    <div className="enhanced-build-progress">
      {/* Connection Status */}
      {connectionHealth && (
        <div className={`connection-status ${connectionHealth.connected ? 'connected' : 'disconnected'}`}>
          <div className="status-indicator">
            <span className={`status-dot ${connectionHealth.connected ? 'green' : 'red'}`} />
            {connectionHealth.connected ? 'Connected' : 'Reconnecting...'}
            {connectionHealth.reconnectAttempts > 0 && (
              <span className="reconnect-info">
                (Attempt {connectionHealth.reconnectAttempts})
              </span>
            )}
          </div>
          {connectionHealth.latencyMs && (
            <span className="latency">
              {connectionHealth.latencyMs}ms
            </span>
          )}
        </div>
      )}

      {/* Stage Progress */}
      {stageProgress && (
        <div className="stage-progress-container">
          <div className="stage-header">
            <h3 className="stage-title">{stageProgress.title}</h3>
            <div className="stage-status">
              <StatusBadge status={stageProgress.status} />
              {stageProgress.estimatedDurationMs && stageProgress.status === 'running' && (
                <TimeEstimate 
                  startTime={stageProgress.startedAt} 
                  estimatedDuration={stageProgress.estimatedDurationMs} 
                />
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="stage-progress-bar">
            <div 
              className={`progress-fill ${stageProgress.status}`}
              style={{ 
                width: `${getStageProgress(stageProgress)}%`,
                transition: 'width 0.3s ease-in-out'
              }}
            />
          </div>

          {/* Substeps */}
          <div className="substeps-container">
            {stageProgress.substeps.map((substep) => (
              <div 
                key={substep.id} 
                className={`substep ${substep.status} ${substep.id === stageProgress.currentSubstep ? 'active' : ''}`}
              >
                <div className="substep-header">
                  <span className="substep-icon">
                    {getSubstepIcon(substep.status)}
                  </span>
                  <span className="substep-title">{substep.title}</span>
                  {substep.status === 'running' && substep.progress !== undefined && (
                    <span className="substep-progress">{Math.round(substep.progress)}%</span>
                  )}
                  {substep.startedAt && substep.completedAt && (
                    <span className="substep-duration">
                      {substep.completedAt - substep.startedAt}ms
                    </span>
                  )}
                </div>
                
                {substep.detail && (
                  <div className="substep-detail">{substep.detail}</div>
                )}
                
                {substep.status === 'running' && substep.progress !== undefined && (
                  <div className="substep-progress-bar">
                    <div 
                      className="substep-progress-fill"
                      style={{ width: `${substep.progress}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error Summary */}
      {errorContext && errorContext.length > 0 && (
        <div className="error-summary">
          <div className="error-summary-header">
            <span className="error-icon">⚠️</span>
            <span className="error-count">{errorContext.length} issues detected</span>
          </div>
          <div className="error-list">
            {errorContext.slice(0, 3).map((error) => (
              <div key={error.id} className={`error-item ${error.severity}`}>
                <div className="error-header">
                  <span className="error-code">{error.code}</span>
                  {error.file && <span className="error-file">{error.file}:{error.line}</span>}
                </div>
                <div className="error-message">{error.message}</div>
                {error.suggestion && (
                  <div className="error-suggestion">💡 {error.suggestion}</div>
                )}
              </div>
            ))}
            {errorContext.length > 3 && (
              <div className="error-more">
                +{errorContext.length - 3} more issues
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'pending' | 'running' | 'completed' | 'failed' }) {
  const config = {
    pending: { icon: '⏳', label: 'Pending', className: 'pending' },
    running: { icon: '⚡', label: 'Running', className: 'running' },
    completed: { icon: '✅', label: 'Completed', className: 'completed' },
    failed: { icon: '❌', label: 'Failed', className: 'failed' },
  };

  const { icon, label, className } = config[status];
  
  return (
    <span className={`status-badge ${className}`}>
      {icon} {label}
    </span>
  );
}

function TimeEstimate({ startTime, estimatedDuration }: { startTime: number; estimatedDuration: number }) {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  const remaining = Math.max(0, estimatedDuration - elapsed);
  const elapsedSeconds = Math.floor(elapsed / 1000);
  const remainingSeconds = Math.floor(remaining / 1000);

  return (
    <div className="time-estimate">
      <span className="elapsed">{elapsedSeconds}s</span>
      {remaining > 0 && (
        <span className="remaining">~{remainingSeconds}s left</span>
      )}
    </div>
  );
}

function getSubstepIcon(status: string): string {
  switch (status) {
    case 'pending': return '⏳';
    case 'running': return '⚡';
    case 'completed': return '✅';
    case 'failed': return '❌';
    case 'skipped': return '⏭️';
    default: return '•';
  }
}

function getStageProgress(stage: StageProgress): number {
  if (stage.status === 'completed') return 100;
  if (stage.status === 'failed') return 100;
  if (stage.status === 'pending') return 0;

  // Calculate based on substeps
  const totalSteps = stage.substeps.length;
  if (totalSteps === 0) return stage.status === 'running' ? 50 : 0;

  let progress = 0;
  for (const substep of stage.substeps) {
    if (substep.status === 'completed') progress += 100;
    else if (substep.status === 'running' && substep.progress !== undefined) progress += substep.progress;
  }

  return Math.round(progress / totalSteps);
}