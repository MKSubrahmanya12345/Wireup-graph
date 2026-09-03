import type { ValidationFinding, ValidationReport, BuildEvent } from './types.js';

/** Enhanced error context with debugging information */
export interface ErrorContext {
  id: string;
  timestamp: number;
  stage: string;
  operation: string;
  severity: 'error' | 'warning' | 'notice';
  message: string;
  details?: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  suggestion?: string;
  relatedErrors?: string[];
  stackTrace?: string;
  environment?: Record<string, any>;
  duration?: number;
  retryCount?: number;
}

/** Detailed operation tracking */
export interface OperationTrace {
  id: string;
  stage: string;
  operation: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  steps: OperationStep[];
  errors: ErrorContext[];
  metadata?: Record<string, any>;
}

export interface OperationStep {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  output?: string;
  error?: string;
  duration?: number;
}

/** Enhanced logging and error tracking system */
export class ErrorContextTracker {
  private errorContexts: Map<string, ErrorContext> = new Map();
  private operations: Map<string, OperationTrace> = new Map();
  private emitFn: (event: BuildEvent) => void;

  constructor(emit: (event: BuildEvent) => void) {
    this.emitFn = emit;
  }

  /**
   * Emit a build event on this tracker's channel.
   *
   * Collaborators (e.g. {@link DetailedLogger}) go through this instead of
   * reaching into `emitFn`, which stays private.
   */
  emit(event: BuildEvent): void {
    this.emitFn(event);
  }

  /** Start tracking an operation */
  startOperation(stage: string, operation: string, metadata?: Record<string, any>): string {
    const id = this.generateId();
    const trace: OperationTrace = {
      id,
      stage,
      operation,
      startTime: Date.now(),
      status: 'running',
      steps: [],
      errors: [],
      metadata,
    };

    this.operations.set(id, trace);
    
    this.emitFn({
      type: 'log',
      stage,
      line: `[${this.formatTime()}] 🚀 Starting ${operation}`,
      tone: 'info',
    });

    return id;
  }

  /** Add a step to an operation */
  addStep(operationId: string, stepName: string, output?: string): string {
    const operation = this.operations.get(operationId);
    if (!operation) return '';

    const stepId = this.generateId();
    const step: OperationStep = {
      id: stepId,
      name: stepName,
      startTime: Date.now(),
      status: 'running',
      output,
    };

    operation.steps.push(step);
    
    this.emitFn({
      type: 'log',
      stage: operation.stage,
      line: `[${this.formatTime()}] 📋 ${stepName}`,
      tone: 'info',
    });

    return stepId;
  }

  /** Complete a step */
  completeStep(operationId: string, stepId: string, output?: string): void {
    const operation = this.operations.get(operationId);
    if (!operation) return;

    const step = operation.steps.find(s => s.id === stepId);
    if (!step) return;

    step.endTime = Date.now();
    step.duration = step.endTime - step.startTime;
    step.status = 'completed';
    if (output) step.output = output;

    this.emitFn({
      type: 'log',
      stage: operation.stage,
      line: `[${this.formatTime()}] ✅ ${step.name} (${step.duration}ms)`,
      tone: 'ok',
    });
  }

  /** Fail a step with error details */
  failStep(operationId: string, stepId: string, error: string): void {
    const operation = this.operations.get(operationId);
    if (!operation) return;

    const step = operation.steps.find(s => s.id === stepId);
    if (!step) return;

    step.endTime = Date.now();
    step.duration = step.endTime - step.startTime;
    step.status = 'failed';
    step.error = error;

    this.emitFn({
      type: 'log',
      stage: operation.stage,
      line: `[${this.formatTime()}] ❌ ${step.name} failed: ${error}`,
      tone: 'error',
    });
  }

  /** Complete an operation */
  completeOperation(operationId: string): void {
    const operation = this.operations.get(operationId);
    if (!operation) return;

    operation.endTime = Date.now();
    operation.status = 'completed';

    const duration = operation.endTime - operation.startTime;
    const stepCount = operation.steps.length;
    const failedSteps = operation.steps.filter(s => s.status === 'failed').length;

    this.emitFn({
      type: 'log',
      stage: operation.stage,
      line: `[${this.formatTime()}] 🎉 ${operation.operation} completed (${duration}ms, ${stepCount} steps, ${failedSteps} failures)`,
      tone: 'ok',
    });
  }

  /** Fail an operation */
  failOperation(operationId: string, error: string): void {
    const operation = this.operations.get(operationId);
    if (!operation) return;

    operation.endTime = Date.now();
    operation.status = 'failed';

    const duration = operation.endTime - operation.startTime;
    this.emitFn({
      type: 'log',
      stage: operation.stage,
      line: `[${this.formatTime()}] 💥 ${operation.operation} failed: ${error} (${duration}ms)`,
      tone: 'error',
    });
  }

  /** Add detailed error context */
  addError(
    stage: string,
    operation: string,
    message: string,
    options: Partial<Omit<ErrorContext, 'id' | 'timestamp' | 'stage' | 'operation' | 'message'>> = {},
  ): string {
    const id = this.generateId();
    const errorContext: ErrorContext = {
      id,
      timestamp: Date.now(),
      stage,
      operation,
      severity: options.severity || 'error',
      message,
      ...options,
    };

    this.errorContexts.set(id, errorContext);

    // Emit detailed log with context
    const contextInfo = [
      errorContext.code && `Code: ${errorContext.code}`,
      errorContext.file && `File: ${errorContext.file}${errorContext.line ? `:${errorContext.line}` : ''}`,
      errorContext.retryCount && `Retry: ${errorContext.retryCount}`,
    ].filter(Boolean).join(', ');

    const logLine = contextInfo 
      ? `[${this.formatTime()}] ${message} (${contextInfo})`
      : `[${this.formatTime()}] ${message}`;

    this.emitFn({
      type: 'log',
      stage,
      line: logLine,
      tone: errorContext.severity === 'error' ? 'error' : 'warn',
    });

    // If there's a suggestion, emit it as a separate info line
    if (errorContext.suggestion) {
      this.emitFn({
        type: 'log',
        stage,
        line: `[${this.formatTime()}] 💡 Suggestion: ${errorContext.suggestion}`,
        tone: 'info',
      });
    }

    return id;
  }

  /** Convert ValidationFindings to enhanced error contexts */
  processValidationReport(report: ValidationReport): void {
    // A report has no `stage` field — it is scoped by `target`, which is the
    // stage name for reporting purposes ('firmware' | 'software' | ...).
    const stage: string = report.target;

    for (const finding of report.findings) {
      const errorId = this.addError(stage, 'validation', finding.message, {
        severity: finding.severity,
        code: finding.code,
        file: finding.file,
        line: finding.line,
        suggestion: finding.hint,
      });

      // Add to current operation if one exists
      const currentOp = this.getCurrentOperation(stage);
      if (currentOp) {
        currentOp.errors.push(this.errorContexts.get(errorId)!);
      }
    }

    // Process commands with detailed output
    for (const command of report.commands) {
      if (command.exitCode !== 0) {
        this.addError(stage, 'command', `Command failed: ${command.cmd}`, {
          severity: 'error',
          code: `EXIT_${command.exitCode}`,
          details: command.output,
          duration: command.durationMs,
        });
      } else {
        this.emitFn({
          type: 'log',
          stage,
          line: `[${this.formatTime()}] ✅ Command succeeded: ${command.cmd} (${command.durationMs}ms)`,
          tone: 'ok',
        });
      }
    }

    // Process validation checks
    for (const check of report.checks) {
      if (!check.ok) {
        this.addError(stage, 'validation-check', check.detail, {
          severity: 'error',
          code: check.name.toUpperCase().replace(/\s+/g, '_'),
        });
      }
    }
  }

  /** Get error summary for a stage */
  getErrorSummary(stage: string): {
    totalErrors: number;
    errorsByType: Record<string, number>;
    criticalErrors: ErrorContext[];
    recentErrors: ErrorContext[];
  } {
    const stageErrors = Array.from(this.errorContexts.values())
      .filter(error => error.stage === stage);

    const errorsByType: Record<string, number> = {};
    for (const error of stageErrors) {
      const type = error.code || 'unknown';
      errorsByType[type] = (errorsByType[type] || 0) + 1;
    }

    const criticalErrors = stageErrors
      .filter(error => error.severity === 'error')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);

    const recentErrors = stageErrors
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

    return {
      totalErrors: stageErrors.length,
      errorsByType,
      criticalErrors,
      recentErrors,
    };
  }

  /** Get operation details for debugging */
  getOperationDetails(operationId: string): OperationTrace | null {
    return this.operations.get(operationId) || null;
  }

  /** Get all operations for a stage */
  getStageOperations(stage: string): OperationTrace[] {
    return Array.from(this.operations.values())
      .filter(op => op.stage === stage)
      .sort((a, b) => a.startTime - b.startTime);
  }

  /** Export error context for debugging */
  exportErrorContext(): {
    errors: ErrorContext[];
    operations: OperationTrace[];
    summary: Record<string, any>;
  } {
    return {
      errors: Array.from(this.errorContexts.values()),
      operations: Array.from(this.operations.values()),
      summary: {
        totalErrors: this.errorContexts.size,
        totalOperations: this.operations.size,
        activeOperations: Array.from(this.operations.values()).filter(op => op.status === 'running').length,
        errorsByStage: this.getErrorsByStage(),
      },
    };
  }

  /** Clear old contexts to prevent memory leaks */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 1000 * 60 * 60; // 1 hour

    for (const [id, context] of this.errorContexts) {
      if (now - context.timestamp > maxAge) {
        this.errorContexts.delete(id);
      }
    }

    for (const [id, operation] of this.operations) {
      if (now - operation.startTime > maxAge) {
        this.operations.delete(id);
      }
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  private formatTime(): string {
    return new Date().toTimeString().slice(0, 8);
  }

  private getCurrentOperation(stage: string): OperationTrace | null {
    for (const operation of this.operations.values()) {
      if (operation.stage === stage && operation.status === 'running') {
        return operation;
      }
    }
    return null;
  }

  private getErrorsByStage(): Record<string, number> {
    const errorsByStage: Record<string, number> = {};
    for (const error of this.errorContexts.values()) {
      errorsByStage[error.stage] = (errorsByStage[error.stage] || 0) + 1;
    }
    return errorsByStage;
  }
}

/** Enhanced logging utilities */
export class DetailedLogger {
  private errorTracker: ErrorContextTracker;

  constructor(errorTracker: ErrorContextTracker) {
    this.errorTracker = errorTracker;
  }

  /** Log a command execution with full context */
  logCommand(stage: string, cmd: string, cwd?: string): void {
    this.errorTracker.emit({
      type: 'command',
      stage,
      cmd,
      cwd,
    });
  }

  /** Log command result with timing and output analysis */
  logCommandResult(
    stage: string,
    cmd: string,
    exitCode: number | null,
    output: string,
    durationMs: number,
  ): void {
    this.errorTracker.emit({
      type: 'command_result',
      stage,
      cmd,
      exitCode,
      output,
      durationMs,
    });

    // Add additional context for failed commands
    if (exitCode !== 0) {
      this.errorTracker.addError(stage, 'command', `Command failed: ${cmd}`, {
        code: `EXIT_${exitCode}`,
        details: output,
        duration: durationMs,
        suggestion: this.getCommandSuggestion(cmd, exitCode, output),
      });
    }
  }

  /** Log file operations */
  logFileOperation(stage: string, operation: string, path: string, success: boolean, details?: string): void {
    const tone = success ? 'ok' : 'error';
    const status = success ? '✅' : '❌';
    
    this.errorTracker.emit({
      type: 'log',
      stage,
      line: `[${new Date().toTimeString().split(' ')[0]}] ${status} ${operation}: ${path}${details ? ` (${details})` : ''}`,
      tone,
    });

    if (!success) {
      this.errorTracker.addError(stage, 'file-operation', `${operation} failed: ${path}`, {
        file: path,
        details,
        suggestion: 'Check file permissions and disk space',
      });
    }
  }

  /** Log network operations */
  logNetworkOperation(stage: string, operation: string, url: string, success: boolean, duration?: number): void {
    const tone = success ? 'ok' : 'error';
    const status = success ? '🌐' : '🚫';
    const durationInfo = duration ? ` (${duration}ms)` : '';
    
    this.errorTracker.emit({
      type: 'log',
      stage,
      line: `[${new Date().toTimeString().split(' ')[0]}] ${status} ${operation}: ${url}${durationInfo}`,
      tone,
    });

    if (!success) {
      this.errorTracker.addError(stage, 'network', `${operation} failed: ${url}`, {
        details: `Duration: ${duration}ms`,
        suggestion: 'Check network connectivity and API availability',
      });
    }
  }

  private getCommandSuggestion(cmd: string, exitCode: number | null, output: string): string | undefined {
    // Command-specific suggestions based on common failure patterns
    if (cmd.includes('npm') || cmd.includes('yarn') || cmd.includes('pnpm')) {
      if (output.includes('ENOENT')) return 'Try running npm install to install dependencies';
      if (output.includes('permission')) return 'Check file permissions or run with appropriate privileges';
      if (output.includes('network')) return 'Check network connectivity and registry access';
    }

    if (cmd.includes('tsc') || cmd.includes('typescript')) {
      if (output.includes('Cannot find module')) return 'Install missing dependencies or check import paths';
      if (output.includes('Type')) return 'Fix TypeScript type errors shown above';
    }

    if (cmd.includes('g++') || cmd.includes('gcc')) {
      if (output.includes('No such file')) return 'Check that all header files and libraries are available';
      if (output.includes('undefined reference')) return 'Link required libraries or check function definitions';
    }

    return undefined;
  }
}