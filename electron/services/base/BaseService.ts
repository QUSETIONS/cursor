import { Logger } from '../../utils/Logger';
import { RetryPolicy } from './RetryPolicy';
import { CircuitBreaker } from './CircuitBreaker';

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'degraded' | 'error';

/**
 * Base class for all services. Provides:
 * - Lifecycle management (init/shutdown)
 * - Health checking
 * - Built-in retry and circuit breaker
 * - Structured logging
 * 
 * Fixes original Issue #6: All logic in one monolithic file.
 */
export abstract class BaseService {
  protected logger: Logger;
  protected retry: RetryPolicy;
  protected breaker: CircuitBreaker;
  private _status: ServiceStatus = 'stopped';

  constructor(name: string) {
    this.logger = Logger.create(name);
    this.retry = new RetryPolicy({ maxRetries: 3 });
    this.breaker = new CircuitBreaker(name);
  }

  get status(): ServiceStatus {
    return this._status;
  }

  protected setStatus(status: ServiceStatus): void {
    this._status = status;
    this.logger.info(`Status → ${status}`);
  }

  /**
   * Initialize the service. Called once on startup.
   */
  async start(): Promise<void> {
    this.setStatus('starting');
    try {
      await this.initialize();
      this.setStatus('running');
    } catch (error) {
      this.setStatus('error');
      this.logger.error(`Failed to start: ${error}`);
      throw error;
    }
  }

  /**
   * Gracefully stop the service.
   */
  async stop(): Promise<void> {
    try {
      await this.shutdown();
    } finally {
      this.setStatus('stopped');
    }
  }

  /**
   * Execute an operation with retry + circuit breaker protection.
   */
  protected async withResilience<T>(
    operation: () => Promise<T>,
    context?: string
  ): Promise<T> {
    return this.breaker.call(() => this.retry.execute(operation, context));
  }

  // ─── Abstract methods for subclasses ───

  protected abstract initialize(): Promise<void>;
  protected abstract shutdown(): Promise<void>;
  abstract healthCheck(): Promise<boolean>;
}
