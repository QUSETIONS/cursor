# TG2: Registration Engine Resilience Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `TaskOrchestrator` wrapper around `PipelineFactory` that leases a proxy, passes it directly to Puppeteer, handles execution, and provides success/failure feedback (including retry logic on proxy bans).

**Architecture:** Instead of PipelineFactory launching via `http://localhost:50000`, the new Orchestrator will request a specific leased proxy from the `ProxyPoolService`. If the registration hits a known IP block (Cloudflare Access Denied/Turnstile infinite loop), it releases the proxy with a negative score, requests a new one, and retries up to 3 times.

**Tech Stack:** TypeScript, Node.js, Puppeteer

---

### Task 1: Create TaskOrchestrator

**Files:**
- Create: `d:\Desktop\cursor\nirvana-rebuild\electron\services\registration\TaskOrchestrator.ts`
- Modify: `d:\Desktop\cursor\nirvana-rebuild\electron\services\registration\PipelineFactory.ts`

- [ ] **Step 1: Define `TaskOrchestrator` Interface**
```typescript
import { randomUUID } from 'crypto';
import { ProxyPoolService } from '../ProxyPoolService';
import { PipelineFactory } from './PipelineFactory';

export class TaskOrchestrator {
  constructor(private proxyPool: ProxyPoolService) {}

  public async runWithResilience(platform: string, config: any): Promise<any> {
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      const taskId = randomUUID();
      const proxy = this.proxyPool.leaseProxy(taskId);
      
      if (!proxy) throw new Error('No proxies available in pool');

      try {
        // Pass the leased proxy directly to the pipeline
        config.proxyServer = proxy.url; 
        const result = await PipelineFactory.run(platform, config);
        
        // Success feedback
        this.proxyPool.releaseProxy(taskId, true);
        return result;
      } catch (err: any) {
        // Failure feedback
        const isIpBan = err.message.includes('cloudflare') || err.message.includes('access denied');
        this.proxyPool.releaseProxy(taskId, false, isIpBan ? 'ip_blocked' : 'timeout');
        
        if (isIpBan && attempts < 3) {
          console.log(`[TaskOrchestrator] IP blocked, retrying (${attempts}/3)...`);
          continue;
        }
        throw err;
      }
    }
  }
}
```

- [ ] **Step 2: Update `PipelineFactory.ts` to accept `--proxy-server`**
Ensure that the `PipelineFactory` and underlying strategies (`CursorRegistrationFlow`, etc.) consume `config.proxyServer` and pass it to Puppeteer `args: ['--proxy-server=' + config.proxyServer]`.

- [ ] **Step 3: Commit changes**
Commit message: "feat(registration): implement TaskOrchestrator with proxy retry resilience"
