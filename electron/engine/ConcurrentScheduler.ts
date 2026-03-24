/**
 * ConcurrentScheduler — Inspired by any-auto-register's concurrent registration system
 * Manages parallel registration tasks with configurable concurrency, queue, and SSE-like events
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/Logger';

export type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface SchedulerTask {
  id: string;
  platform: string;
  email: string;
  status: TaskStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: Record<string, any>;
  retryCount: number;
}

export interface SchedulerConfig {
  maxConcurrent: number;        // e.g. 3
  retryLimit: number;           // e.g. 2
  delayBetweenTasksMs: number;  // e.g. 2000
  delayJitterMs: number;        // random jitter e.g. 1000
}

const DEFAULT_CONFIG: SchedulerConfig = {
  maxConcurrent: 3,
  retryLimit: 2,
  delayBetweenTasksMs: 3000,
  delayJitterMs: 2000,
};

export class ConcurrentScheduler extends EventEmitter {
  private queue: SchedulerTask[] = [];
  private running: Map<string, SchedulerTask> = new Map();
  private completed: SchedulerTask[] = [];
  private config: SchedulerConfig;
  private isActive = false;
  private log = createLogger('Scheduler');
  private taskHandler!: (task: SchedulerTask) => Promise<{ success: boolean; result?: any; error?: string }>;

  constructor(config?: Partial<SchedulerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the task execution handler
   */
  setHandler(handler: (task: SchedulerTask) => Promise<{ success: boolean; result?: any; error?: string }>): void {
    this.taskHandler = handler;
  }

  /**
   * Add tasks to the queue
   */
  addTasks(tasks: Array<{ platform: string; email: string }>): string[] {
    const ids: string[] = [];
    for (const t of tasks) {
      const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const task: SchedulerTask = {
        id,
        platform: t.platform,
        email: t.email,
        status: 'queued',
        retryCount: 0,
      };
      this.queue.push(task);
      ids.push(id);
    }
    this.emit('queue-updated', { queued: this.queue.length, running: this.running.size });
    return ids;
  }

  /**
   * Start processing the queue
   */
  async start(): Promise<void> {
    if (this.isActive) return;
    this.isActive = true;
    this.log.info(`Scheduler started (concurrency: ${this.config.maxConcurrent})`);
    this.emit('started');

    while (this.isActive && (this.queue.length > 0 || this.running.size > 0)) {
      // Fill up to maxConcurrent
      while (this.isActive && this.running.size < this.config.maxConcurrent && this.queue.length > 0) {
        const task = this.queue.shift()!;
        this.running.set(task.id, task);
        this.executeTask(task); // fire-and-forget
        // Stagger start times
        const delay = this.config.delayBetweenTasksMs + Math.random() * this.config.delayJitterMs;
        await this.delay(delay);
      }

      // Wait a bit before checking again
      await this.delay(1000);
    }

    this.isActive = false;
    this.log.info('Scheduler completed');
    this.emit('completed', this.getStats());
  }

  /**
   * Stop the scheduler (finish running tasks, discard queue)
   */
  stop(): void {
    this.isActive = false;
    // Cancel queued tasks
    for (const task of this.queue) {
      task.status = 'cancelled';
      this.completed.push(task);
    }
    this.queue = [];
    this.emit('stopped');
    this.log.info('Scheduler stopped');
  }

  /**
   * Execute a single task with retry
   */
  private async executeTask(task: SchedulerTask): Promise<void> {
    task.status = 'running';
    task.startedAt = Date.now();
    this.emitProgress(task, 'started');

    try {
      const result = await this.taskHandler(task);

      if (result.success) {
        task.status = 'success';
        task.result = result.result;
        task.completedAt = Date.now();
        this.emitProgress(task, 'success');
      } else {
        // Retry?
        if (task.retryCount < this.config.retryLimit) {
          task.retryCount++;
          task.status = 'queued';
          this.queue.unshift(task); // re-queue at front
          this.emitProgress(task, 'retry');
        } else {
          task.status = 'failed';
          task.error = result.error || '未知错误';
          task.completedAt = Date.now();
          this.emitProgress(task, 'failed');
        }
      }
    } catch (err) {
      if (task.retryCount < this.config.retryLimit) {
        task.retryCount++;
        task.status = 'queued';
        this.queue.unshift(task);
        this.emitProgress(task, 'retry');
      } else {
        task.status = 'failed';
        task.error = err instanceof Error ? err.message : String(err);
        task.completedAt = Date.now();
        this.emitProgress(task, 'failed');
      }
    } finally {
      this.running.delete(task.id);
      if (task.status !== 'queued') {
        this.completed.push(task);
      }
    }
  }

  private emitProgress(task: SchedulerTask, event: string): void {
    const stats = this.getStats();
    this.emit('task-progress', {
      event,
      task: { id: task.id, email: task.email, platform: task.platform, status: task.status, error: task.error },
      stats,
    });
  }

  getStats(): {
    queued: number;
    running: number;
    success: number;
    failed: number;
    cancelled: number;
    total: number;
  } {
    return {
      queued: this.queue.length,
      running: this.running.size,
      success: this.completed.filter(t => t.status === 'success').length,
      failed: this.completed.filter(t => t.status === 'failed').length,
      cancelled: this.completed.filter(t => t.status === 'cancelled').length,
      total: this.queue.length + this.running.size + this.completed.length,
    };
  }

  getCompleted(): SchedulerTask[] {
    return [...this.completed];
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
