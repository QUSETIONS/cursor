import { randomUUID } from 'node:crypto';
import { ProxyPoolService } from '../ProxyPoolService';
import { Logger } from '../../utils/Logger';

export interface TaskConfig {
  platform: string;
  [key: string]: any;
}

export interface TaskResult {
  success: boolean;
  email?: string;
  password?: string;
  token?: string;
  error?: string;
  proxyIp?: string;
}

/**
 * TaskOrchestrator acts as the Gatling Gun's Resilience Engine.
 * It leases a proxy, hands it to a runner strategy, and gracefully
 * retries on proxy blocks or timeouts up to a maximum attempt limit.
 */
export class TaskOrchestrator {
  private log = Logger.create('TaskOrchestrator');
  
  constructor(private proxyPool: ProxyPoolService) {}

  /**
   * Run a registration task with built-in resilience (auto-retry).
   * 
   * @param taskName A label for logging (e.g. 'CursorRegistrationTask')
   * @param config Configuration parameters to pass to the runner
   * @param runner The actual execution logic (e.g. PipelineFactory.run)
   * @param maxAttempts Maximum number of retries per proxy ban
   */
  public async runWithResilience(
    taskName: string,
    config: TaskConfig,
    runner: (config: TaskConfig & { proxyServer: string }) => Promise<TaskResult>,
    maxAttempts: number = 3
  ): Promise<TaskResult> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      const taskId = randomUUID();
      
      this.log.info(`[${taskName}] Attempt ${attempts}/${maxAttempts}. Leasing proxy...`);
      const proxy = this.proxyPool.leaseProxy(taskId);
      
      if (!proxy) {
        throw new Error('No proxies available in Ghost Fleet pool. Cannot start task.');
      }

      const proxyUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
      this.log.info(`[${taskName}] Leased proxy: ${proxyUrl} (Score: ${proxy.qualityScore})`);

      try {
        // Run the injected strategy
        const result = await runner({ ...config, proxyServer: proxyUrl });
        
        if (result.success) {
          this.log.info(`[${taskName}] 🎉 Target secured. Releasing proxy with SUCCESS score.`);
          result.proxyIp = proxy.host;
          this.proxyPool.releaseProxy(taskId, true);
          return result;
        } else {
          // Normal failure (not an exception)
          const errorStr = result.error?.toLowerCase() || '';
          const isIpBan = errorStr.includes('cloudflare') || errorStr.includes('access denied') || errorStr.includes('turnstile');
          const reason = isIpBan ? 'ip_blocked' : 'timeout';
          
          this.log.warn(`[${taskName}] Task failed: ${result.error}. Releasing code: ${reason}`);
          this.proxyPool.releaseProxy(taskId, false, reason);
          
          if (isIpBan && attempts < maxAttempts) {
            this.log.info(`[${taskName}] Retrying due to IP ban...`);
            continue;
          }
          return result;
        }
      } catch (err: any) {
        // Hard exception from the runner
        const isIpBan = err.message.toLowerCase().includes('cloudflare') || err.message.toLowerCase().includes('access denied');
        const reason = isIpBan ? 'ip_blocked' : 'timeout';
        
        this.log.error(`[${taskName}] Caught exception: ${err.message}. Releasing code: ${reason}`);
        this.proxyPool.releaseProxy(taskId, false, reason);
        
        if (isIpBan && attempts < maxAttempts) {
          this.log.info(`[${taskName}] Retrying due to IP ban...`);
          continue;
        }
        
        // Stop retrying on non-IP related bugs (e.g. dom changed)
        return { success: false, error: err.message, proxyIp: proxy.host };
      }
    }

    return { success: false, error: 'Maximum attempts reached without success.' };
  }
}
