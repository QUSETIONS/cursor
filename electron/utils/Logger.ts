/**
 * Structured logger with levels and scoped names.
 * In production, writes to electron-log. In dev, uses console.
 */
import { EventEmitter } from 'events';

export const logEmitter = new EventEmitter();

export class Logger {
  private constructor(private scope: string) {}

  static create(scope: string): Logger {
    return new Logger(scope);
  }

  private format(level: string, message: string): string {
    const ts = new Date().toISOString().substring(11, 23);
    const out = `[${ts}] [${level}] [${this.scope}] ${message}`;
    logEmitter.emit('log', out);
    return out;
  }

  /**
   * Safe write — swallows EPIPE / broken-pipe errors so the main
   * process doesn't crash when stdout/stderr is disconnected.
   */
  private safeWrite(fn: (...a: unknown[]) => void, msg: string, args: unknown[]): void {
    try {
      fn(msg, ...args);
    } catch (e: any) {
      if (e?.code !== 'EPIPE' && e?.code !== 'ERR_STREAM_DESTROYED') throw e;
      // stdout/stderr pipe is gone — silently discard
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.safeWrite(console.debug.bind(console), this.format('DEBUG', message), args);
  }

  info(message: string, ...args: unknown[]): void {
    this.safeWrite(console.info.bind(console), this.format('INFO', message), args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.safeWrite(console.warn.bind(console), this.format('WARN', message), args);
  }

  error(message: string, ...args: unknown[]): void {
    this.safeWrite(console.error.bind(console), this.format('ERROR', message), args);
  }

  /** Log with "user" level — pushed to frontend for display */
  user(message: string): void {
    this.safeWrite(console.info.bind(console), this.format('USER', message), []);
  }
}

/** Convenience factory — used by services */
export function createLogger(scope: string): Logger {
  return Logger.create(scope);
}
