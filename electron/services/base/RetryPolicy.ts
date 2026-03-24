import { Logger } from '../../utils/Logger';

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

/**
 * Retry policy with exponential backoff + jitter.
 * 
 * Fixes original Issue #7: No error retry strategy.
 */
export class RetryPolicy {
  private logger = Logger.create('RetryPolicy');
  private options: RetryOptions;

  constructor(options: Partial<RetryOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async execute<T>(fn: () => Promise<T>, context?: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt >= this.options.maxRetries) {
          break;
        }

        // Check if error is retryable
        if (this.options.retryableErrors?.length) {
          const isRetryable = this.options.retryableErrors.some(
            (e) => lastError!.message.includes(e)
          );
          if (!isRetryable) break;
        }

        // Calculate delay with exponential backoff + jitter
        const exponentialDelay =
          this.options.baseDelay * Math.pow(this.options.backoffMultiplier, attempt);
        const jitter = Math.random() * this.options.baseDelay * 0.5;
        const delay = Math.min(exponentialDelay + jitter, this.options.maxDelay);

        this.logger.warn(
          `${context || 'Operation'} failed (attempt ${attempt + 1}/${this.options.maxRetries}), ` +
            `retrying in ${Math.round(delay)}ms: ${lastError.message}`
        );

        this.options.onRetry?.(attempt + 1, lastError, delay);
        await this.sleep(delay);
      }
    }

    throw lastError || new Error('RetryPolicy: unknown error');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
