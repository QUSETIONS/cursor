import { Logger } from '../utils/Logger';
import type { BrowserWindow } from 'electron';
import { Channels } from '../ipc/channels';

export interface ProgressState {
  current: number;
  total: number;
  success: number;
  fail: number;
  currentEmail: string;
  currentStep: string;
  stepProgress: number;
  errors: ErrorEntry[];
  estimatedTimeRemaining: number;
  startTime: number;
}

export interface ErrorEntry {
  email: string;
  step: string;
  message: string;
  timestamp: number;
  retryable: boolean;
}

/**
 * Tracks registration progress and pushes updates to the renderer.
 */
export class ProgressTracker {
  private logger = Logger.create('ProgressTracker');
  private state: ProgressState;
  private window: BrowserWindow | null = null;
  private listeners: Array<(state: ProgressState) => void> = [];

  constructor(total: number) {
    this.state = {
      current: 0,
      total,
      success: 0,
      fail: 0,
      currentEmail: '',
      currentStep: '',
      stepProgress: 0,
      errors: [],
      estimatedTimeRemaining: 0,
      startTime: Date.now(),
    };
  }

  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  /**
   * Update progress state and push to renderer.
   */
  update(data: Partial<ProgressState>): void {
    Object.assign(this.state, data);

    // Calculate ETA
    if (this.state.current > 0) {
      const elapsed = Date.now() - this.state.startTime;
      const avgPerItem = elapsed / this.state.current;
      const remaining = this.state.total - this.state.current;
      this.state.estimatedTimeRemaining = Math.round(avgPerItem * remaining);
    }

    // Push to renderer
    this.pushToRenderer();

    // Notify listeners
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * Record a successful registration.
   */
  recordSuccess(email: string): void {
    this.update({
      current: this.state.current + 1,
      success: this.state.success + 1,
      currentEmail: email,
      currentStep: '✅ 完成',
      stepProgress: 100,
    });
    this.logger.info(`✅ [${this.state.current}/${this.state.total}] 注册成功: ${email}`);
  }

  /**
   * Record a failed registration.
   */
  recordFailure(email: string, step: string, message: string, retryable = false): void {
    const error: ErrorEntry = {
      email,
      step,
      message,
      timestamp: Date.now(),
      retryable,
    };
    this.update({
      current: this.state.current + 1,
      fail: this.state.fail + 1,
      currentEmail: email,
      currentStep: `❌ 失败: ${step}`,
      stepProgress: 0,
      errors: [...this.state.errors.slice(-49), error], // Keep last 50 errors
    });
    this.logger.warn(`❌ [${this.state.current}/${this.state.total}] 注册失败: ${email} — ${message}`);
  }

  /**
   * Set current step progress (for in-step updates).
   */
  setStep(email: string, step: string, progress = 0): void {
    this.update({ currentEmail: email, currentStep: step, stepProgress: progress });
  }

  /**
   * Subscribe to progress updates.
   */
  onUpdate(callback: (state: ProgressState) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  getState(): ProgressState {
    return { ...this.state };
  }

  private pushToRenderer(): void {
    try {
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send(Channels.REGISTER_PROGRESS, this.state);
      }
    } catch { /* ignore if window closed */ }
  }
}
