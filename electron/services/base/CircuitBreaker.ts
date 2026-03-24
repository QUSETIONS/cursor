import { Logger } from '../../utils/Logger';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenMax: number;
}

/**
 * Circuit breaker pattern — prevents cascading failures.
 * 
 * CLOSED → failures accumulate → OPEN (fast-fail) → timeout → HALF-OPEN (test) → CLOSED or OPEN
 */
export class CircuitBreaker {
  private logger = Logger.create('CircuitBreaker');
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenSuccesses = 0;

  constructor(
    private name: string,
    private options: CircuitBreakerOptions = {
      failureThreshold: 5,
      resetTimeout: 30000,
      halfOpenMax: 2,
    }
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeout) {
        this.state = 'half-open';
        this.halfOpenSuccesses = 0;
        this.logger.info(`[${this.name}] Transitioning to HALF-OPEN`);
      } else {
        throw new Error(`Circuit breaker [${this.name}] is OPEN — fast-failing`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  getState(): CircuitState {
    // Check if should transition from open to half-open
    if (
      this.state === 'open' &&
      Date.now() - this.lastFailureTime >= this.options.resetTimeout
    ) {
      return 'half-open';
    }
    return this.state;
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.halfOpenSuccesses = 0;
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.options.halfOpenMax) {
        this.state = 'closed';
        this.failureCount = 0;
        this.logger.info(`[${this.name}] Circuit CLOSED (recovered)`);
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.state = 'open';
      this.logger.warn(`[${this.name}] HALF-OPEN test failed → back to OPEN`);
    } else if (this.failureCount >= this.options.failureThreshold) {
      this.state = 'open';
      this.logger.warn(
        `[${this.name}] Failure threshold reached (${this.failureCount}) → OPEN`
      );
    }
  }
}
