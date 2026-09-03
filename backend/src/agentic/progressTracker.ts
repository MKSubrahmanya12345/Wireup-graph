import type { BuildEvent } from './types.js';
import { ErrorContextTracker, DetailedLogger } from './errorContext.js';

export interface StageSubstep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  progress?: number; // 0-100
  detail?: string;
}

export interface StageProgress {
  stage: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  estimatedDurationMs?: number;
  substeps: StageSubstep[];
  currentSubstep?: string; // ID of current substep
}

/** Enhanced progress tracking for agentic build stages */
export class ProgressTracker {
  private stages = new Map<string, StageProgress>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat = Date.now();
  private reconnectAttempts = 0;
  private errorTracker: ErrorContextTracker;
  private logger: DetailedLogger;

  constructor(private emit: (event: BuildEvent) => void) {
    this.errorTracker = new ErrorContextTracker(emit);
    this.logger = new DetailedLogger(this.errorTracker);
  }

  /** Start heartbeat monitoring */
  startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      this.lastHeartbeat = now;
      this.emit({
        type: 'heartbeat',
        timestamp: now,
        health: {
          connected: true,
          lastHeartbeat: now,
          reconnectAttempts: this.reconnectAttempts,
        },
      });
    }, 5000); // Every 5 seconds
  }

  /** Stop heartbeat monitoring */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    // Cleanup error contexts
    this.errorTracker.cleanup();
  }

  /** Get error tracker for advanced logging */
  getErrorTracker(): ErrorContextTracker {
    return this.errorTracker;
  }

  /** Get detailed logger */
  getLogger(): DetailedLogger {
    return this.logger;
  }

  /** Initialize a stage with its expected substeps */
  initStage(stage: string, title: string, substeps: Omit<StageSubstep, 'status'>[]): void {
    const stageProgress: StageProgress = {
      stage,
      title,
      status: 'pending',
      startedAt: Date.now(),
      substeps: substeps.map(substep => ({
        ...substep,
        status: 'pending' as const,
      })),
    };

    // Estimate duration based on stage complexity
    stageProgress.estimatedDurationMs = this.estimateStageDuration(stage, substeps.length);

    this.stages.set(stage, stageProgress);
    this.emit({ type: 'stage_progress', progress: stageProgress });
  }

  /** Start a stage */
  startStage(stage: string, title?: string): void {
    const existing = this.stages.get(stage);
    if (existing) {
      existing.status = 'running';
      existing.startedAt = Date.now();
      if (title) existing.title = title;
      this.emit({ type: 'stage_progress', progress: existing });
    } else {
      // Initialize with basic substeps if not already initialized
      this.initStage(stage, title || stage, [
        { id: 'setup', title: 'Setting up...' },
        { id: 'execute', title: 'Executing...' },
        { id: 'validate', title: 'Validating...' },
      ]);
      this.startStage(stage, title);
    }
  }

  /** Start a substep */
  startSubstep(stage: string, substepId: string, detail?: string): void {
    const stageProgress = this.stages.get(stage);
    if (!stageProgress) return;

    const substep = stageProgress.substeps.find(s => s.id === substepId);
    if (!substep) return;

    substep.status = 'running';
    substep.startedAt = Date.now();
    if (detail) substep.detail = detail;

    stageProgress.currentSubstep = substepId;
    
    this.emit({ type: 'substep', stage, substep });
    this.emit({ type: 'stage_progress', progress: stageProgress });
  }

  /** Update substep progress */
  updateSubstep(stage: string, substepId: string, progress: number, detail?: string): void {
    const stageProgress = this.stages.get(stage);
    if (!stageProgress) return;

    const substep = stageProgress.substeps.find(s => s.id === substepId);
    if (!substep) return;

    substep.progress = Math.min(100, Math.max(0, progress));
    if (detail) substep.detail = detail;

    this.emit({ type: 'substep', stage, substep });
    this.emit({ type: 'stage_progress', progress: stageProgress });
  }

  /** Complete a substep */
  completeSubstep(stage: string, substepId: string, detail?: string): void {
    const stageProgress = this.stages.get(stage);
    if (!stageProgress) return;

    const substep = stageProgress.substeps.find(s => s.id === substepId);
    if (!substep) return;

    substep.status = 'completed';
    substep.completedAt = Date.now();
    substep.progress = 100;
    if (detail) substep.detail = detail;

    this.emit({ type: 'substep', stage, substep });
    this.emit({ type: 'stage_progress', progress: stageProgress });
  }

  /** Fail a substep */
  failSubstep(stage: string, substepId: string, error: string): void {
    const stageProgress = this.stages.get(stage);
    if (!stageProgress) return;

    const substep = stageProgress.substeps.find(s => s.id === substepId);
    if (!substep) return;

    substep.status = 'failed';
    substep.completedAt = Date.now();
    substep.detail = error;

    stageProgress.status = 'failed';
    stageProgress.completedAt = Date.now();

    this.emit({ type: 'substep', stage, substep });
    this.emit({ type: 'stage_progress', progress: stageProgress });
  }

  /** Skip a substep */
  skipSubstep(stage: string, substepId: string, reason?: string): void {
    const stageProgress = this.stages.get(stage);
    if (!stageProgress) return;

    const substep = stageProgress.substeps.find(s => s.id === substepId);
    if (!substep) return;

    substep.status = 'skipped';
    substep.completedAt = Date.now();
    if (reason) substep.detail = reason;

    this.emit({ type: 'substep', stage, substep });
    this.emit({ type: 'stage_progress', progress: stageProgress });
  }

  /** Complete a stage */
  completeStage(stage: string): void {
    const stageProgress = this.stages.get(stage);
    if (!stageProgress) return;

    stageProgress.status = 'completed';
    stageProgress.completedAt = Date.now();
    stageProgress.currentSubstep = undefined;

    // Mark any remaining substeps as completed
    stageProgress.substeps.forEach(substep => {
      if (substep.status === 'pending' || substep.status === 'running') {
        substep.status = 'completed';
        substep.completedAt = Date.now();
        substep.progress = 100;
      }
    });

    this.emit({ type: 'stage_progress', progress: stageProgress });
  }

  /** Fail a stage */
  failStage(stage: string, error: string): void {
    const stageProgress = this.stages.get(stage);
    if (!stageProgress) return;

    stageProgress.status = 'failed';
    stageProgress.completedAt = Date.now();
    stageProgress.currentSubstep = undefined;

    this.emit({ type: 'stage_progress', progress: stageProgress });
  }

  /** Get current stage progress */
  getStageProgress(stage: string): StageProgress | null {
    return this.stages.get(stage) || null;
  }

  /** Get all stages progress */
  getAllProgress(): StageProgress[] {
    return Array.from(this.stages.values());
  }

  /** Estimate stage duration based on complexity */
  private estimateStageDuration(stage: string, substepCount: number): number {
    const baseTimeMs = {
      'retrieve': 5000,
      'software': 30000,
      'software-validate': 25000,
      'firmware': 45000,
      'firmware-validate': 35000,
      'consistency': 8000,
      'simulate': 15000,
      'generate': 10000,
    };

    const base = baseTimeMs[stage as keyof typeof baseTimeMs] || 10000;
    return base + (substepCount * 2000); // Add 2s per substep
  }

  /** Create stage definitions for common stages */
  static getStageDefinitions() {
    return {
      retrieve: {
        title: 'Retrieving device knowledge (RAG)',
        substeps: [
          { id: 'parse-brief', title: 'Parsing project brief' },
          { id: 'knowledge-lookup', title: 'Looking up device knowledge' },
          { id: 'resolve-plan', title: 'Resolving build plan' },
          { id: 'validate-modules', title: 'Validating hardware modules' },
        ],
      },
      software: {
        title: 'Assembling MERN dashboard software',
        substeps: [
          { id: 'synthesize', title: 'Synthesizing software stack' },
          { id: 'merge-files', title: 'Merging scaffold files' },
          { id: 'wire-endpoints', title: 'Wiring device endpoints' },
          { id: 'generate-types', title: 'Generating TypeScript types' },
        ],
      },
      'software-validate': {
        title: 'Building MERN project',
        substeps: [
          { id: 'install-deps', title: 'Installing dependencies' },
          { id: 'type-check', title: 'Type checking' },
          { id: 'build-frontend', title: 'Building frontend' },
          { id: 'build-backend', title: 'Building backend' },
          { id: 'run-tests', title: 'Running tests' },
        ],
      },
      firmware: {
        title: 'Generating firmware',
        substeps: [
          { id: 'llm-draft', title: 'Generating LLM draft' },
          { id: 'apply-revision', title: 'Applying revisions' },
          { id: 'synthesize-kb', title: 'Knowledge base synthesis' },
        ],
      },
      'firmware-validate': {
        title: 'Compiling firmware',
        substeps: [
          { id: 'structural-check', title: 'Structural validation' },
          { id: 'compile', title: 'Compiling with g++' },
          { id: 'contract-check', title: 'Contract validation' },
          { id: 'repair', title: 'Auto-repair if needed' },
        ],
      },
      consistency: {
        title: 'Cross-artifact consistency check',
        substeps: [
          { id: 'extract-fields', title: 'Extracting JSON fields' },
          { id: 'compare', title: 'Comparing contracts' },
          { id: 'validate', title: 'Validating consistency' },
        ],
      },
      simulate: {
        title: 'Hardware simulation',
        substeps: [
          { id: 'prepare-wokwi', title: 'Preparing Wokwi simulation' },
          { id: 'run-simulation', title: 'Running simulation' },
          { id: 'collect-results', title: 'Collecting results' },
          { id: 'validate-output', title: 'Validating output' },
        ],
      },
      generate: {
        title: 'Generating instructions & BOM',
        substeps: [
          { id: 'bom', title: 'Generating bill of materials' },
          { id: 'instructions', title: 'Generating build instructions' },
          { id: 'package', title: 'Packaging artifacts' },
        ],
      },
    };
  }
}