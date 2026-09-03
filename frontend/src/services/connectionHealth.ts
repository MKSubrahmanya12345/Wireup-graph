import type { AgenticEvent, ConnectionHealth } from '../types/build';

export interface ConnectionConfig {
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
  exponentialBackoff: boolean;
}

export interface ConnectionCallbacks {
  onHealthChange: (health: ConnectionHealth) => void;
  onReconnectAttempt: (attempt: number, maxAttempts: number) => void;
  onReconnectSuccess: () => void;
  onReconnectFailed: () => void;
  onEvent: (event: AgenticEvent) => void;
}

const DEFAULT_CONFIG: ConnectionConfig = {
  heartbeatIntervalMs: 5000,
  heartbeatTimeoutMs: 15000,
  maxReconnectAttempts: 5,
  reconnectDelayMs: 1000,
  exponentialBackoff: true,
};

/**
 * Enhanced streaming connection with health monitoring and automatic reconnection.
 * Wraps the basic NDJSON stream with reliability features.
 */
export class StreamConnection {
  private health: ConnectionHealth = {
    connected: false,
    lastHeartbeat: 0,
    reconnectAttempts: 0,
  };
  
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private lastEventTime = 0;
  private isReconnecting = false;
  private abortController: AbortController | null = null;
  
  constructor(
    private config: ConnectionConfig = DEFAULT_CONFIG,
    private callbacks: ConnectionCallbacks,
  ) {}

  /**
   * Start streaming with health monitoring
   */
  async connect(streamFn: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.abortController = new AbortController();
    
    try {
      this.updateHealth({ connected: true, reconnectAttempts: 0 });
      this.startHeartbeatMonitoring();
      
      await streamFn(this.abortController.signal);
      
    } catch (error) {
      if (!this.abortController.signal.aborted) {
        console.warn('Stream connection failed:', error);
        await this.handleConnectionFailure();
      }
    } finally {
      this.cleanup();
    }
  }

  /**
   * Gracefully disconnect
   */
  disconnect(): void {
    this.isReconnecting = false;
    this.abortController?.abort();
    this.cleanup();
    this.updateHealth({ connected: false });
  }

  /**
   * Handle incoming events and update heartbeat
   */
  handleEvent(event: AgenticEvent): void {
    this.lastEventTime = Date.now();
    
    // Handle heartbeat events specially
    if (event.type === 'heartbeat') {
      this.updateHealth({
        lastHeartbeat: event.timestamp,
        latencyMs: Date.now() - event.timestamp,
      });
      return;
    }

    // Forward other events
    this.callbacks.onEvent(event);
  }

  /**
   * Get current connection health
   */
  getHealth(): ConnectionHealth {
    return { ...this.health };
  }

  /**
   * Start monitoring heartbeats
   */
  private startHeartbeatMonitoring(): void {
    this.heartbeatTimer = window.setInterval(() => {
      this.checkHeartbeat();
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Check if we've received recent heartbeats or events
   */
  private checkHeartbeat(): void {
    const now = Date.now();
    const timeSinceLastEvent = now - Math.max(this.health.lastHeartbeat, this.lastEventTime);
    
    if (timeSinceLastEvent > this.config.heartbeatTimeoutMs) {
      console.warn('Heartbeat timeout detected, connection may be lost');
      this.handleConnectionFailure();
    }
  }

  /**
   * Handle connection failure with automatic retry
   */
  private async handleConnectionFailure(): Promise<void> {
    if (this.isReconnecting) return;
    
    this.updateHealth({ connected: false });
    this.isReconnecting = true;
    
    let attempts = 0;
    while (attempts < this.config.maxReconnectAttempts && this.isReconnecting) {
      attempts++;
      this.updateHealth({ reconnectAttempts: attempts });
      
      this.callbacks.onReconnectAttempt(attempts, this.config.maxReconnectAttempts);
      
      const delay = this.config.exponentialBackoff 
        ? this.config.reconnectDelayMs * Math.pow(2, attempts - 1)
        : this.config.reconnectDelayMs;
        
      await this.sleep(delay);
      
      if (!this.isReconnecting) break;
      
      try {
        // Attempt to reconnect by creating a new connection
        await this.attemptReconnect();
        this.callbacks.onReconnectSuccess();
        this.isReconnecting = false;
        return;
      } catch (error) {
        console.warn(`Reconnect attempt ${attempts} failed:`, error);
      }
    }
    
    // All reconnection attempts failed
    this.isReconnecting = false;
    this.callbacks.onReconnectFailed();
  }

  /**
   * Attempt to reconnect (override in subclasses)
   */
  protected async attemptReconnect(): Promise<void> {
    // This should be overridden by specific implementations
    throw new Error('attemptReconnect must be implemented by subclass');
  }

  /**
   * Update health status and notify callbacks
   */
  private updateHealth(update: Partial<ConnectionHealth>): void {
    this.health = { ...this.health, ...update };
    this.callbacks.onHealthChange(this.health);
  }

  /**
   * Cleanup timers and resources
   */
  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      this.reconnectTimer = window.setTimeout(resolve, ms);
    });
  }
}

/**
 * Enhanced streaming API wrapper with automatic reconnection
 */
export class AgenticStreamConnection extends StreamConnection {
  constructor(
    private jobId: string,
    private fromSeq: number,
    private streamFn: (jobId: string, onEvent: (event: AgenticEvent) => void, signal: AbortSignal, fromSeq?: number) => Promise<void>,
    config?: Partial<ConnectionConfig>,
    callbacks?: Partial<ConnectionCallbacks>,
  ) {
    const fullCallbacks: ConnectionCallbacks = {
      onHealthChange: () => {},
      onReconnectAttempt: () => {},
      onReconnectSuccess: () => {},
      onReconnectFailed: () => {},
      onEvent: () => {},
      ...callbacks,
    };
    
    super({ ...DEFAULT_CONFIG, ...config }, fullCallbacks);
  }

  /**
   * Start streaming the agentic job
   */
  async startStreaming(): Promise<void> {
    await this.connect(async (signal) => {
      await this.streamFn(
        this.jobId,
        (event) => this.handleEvent(event),
        signal,
        this.fromSeq,
      );
    });
  }

  /**
   * Attempt to reconnect to the job stream
   */
  protected async attemptReconnect(): Promise<void> {
    // Try to reconnect from the last sequence number
    await this.streamFn(
      this.jobId,
      (event) => this.handleEvent(event),
      new AbortController().signal,
      this.fromSeq,
    );
  }

  /**
   * Update the sequence number for reconnection
   */
  updateSequence(seq: number): void {
    this.fromSeq = seq;
  }
}

/**
 * Connection health monitoring hook for React components
 */
export function createConnectionHealthMonitor() {
  let currentConnection: StreamConnection | null = null;
  let healthCallbacks: Array<(health: ConnectionHealth) => void> = [];
  let statusCallbacks: Array<(status: { reconnecting: boolean; attempts: number; maxAttempts: number }) => void> = [];

  return {
    /**
     * Subscribe to health updates
     */
    onHealthChange(callback: (health: ConnectionHealth) => void): () => void {
      healthCallbacks.push(callback);
      return () => {
        healthCallbacks = healthCallbacks.filter(cb => cb !== callback);
      };
    },

    /**
     * Subscribe to reconnection status updates
     */
    onReconnectionStatus(callback: (status: { reconnecting: boolean; attempts: number; maxAttempts: number }) => void): () => void {
      statusCallbacks.push(callback);
      return () => {
        statusCallbacks = statusCallbacks.filter(cb => cb !== callback);
      };
    },

    /**
     * Start monitoring a connection
     */
    startMonitoring(connection: StreamConnection): void {
      currentConnection = connection;
    },

    /**
     * Get current connection health
     */
    getCurrentHealth(): ConnectionHealth | null {
      return currentConnection?.getHealth() || null;
    },

    /**
     * Disconnect current connection
     */
    disconnect(): void {
      currentConnection?.disconnect();
      currentConnection = null;
    },

    // Internal callback notifiers
    notifyHealthChange: (health: ConnectionHealth) => {
      healthCallbacks.forEach(cb => cb(health));
    },

    notifyReconnectionStatus: (status: { reconnecting: boolean; attempts: number; maxAttempts: number }) => {
      statusCallbacks.forEach(cb => cb(status));
    },
  };
}