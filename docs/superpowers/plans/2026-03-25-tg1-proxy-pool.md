# TG1: Proxy Pool Sticky Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `ProxyPoolService.leaseProxy()` API and feedback-driven `QualityScore` adjustments to support sticky sessions for the Gatling Gun registration engine.

**Architecture:** Extend `ProxyPoolService` with an internal map to track `taskId -> ProxyEntry`. Add methods to lease a proxy (locking it to a task) and release it (updating its quality score based on success/failure). Ensure subscription nodes are prioritized over free nodes.

**Tech Stack:** TypeScript, Node.js

---

### Task 1: Add Leasing and Feedback Methods to `ProxyPoolService`

**Files:**
- Modify: `d:\Desktop\cursor\nirvana-rebuild\electron\services\ProxyPoolService.ts`

- [ ] **Step 1: Understand current ProxyPoolService state**
Review `ProxyPoolService.ts` to understand existing structures (`ProxyEntry`, `getProxy()`, etc.).

- [ ] **Step 2: Add Task Tracking State**
Add private properties mapping active leased proxies:
```typescript
private activeLeases: Map<string, ProxyEntry> = new Map();
```

- [ ] **Step 3: Implement `leaseProxy(taskId)`**
Implementation concept:
```typescript
public leaseProxy(taskId: string): ProxyEntry | null {
  // Return existing if already leased
  if (this.activeLeases.has(taskId)) return this.activeLeases.get(taskId)!;
  // Get best proxy (prioritize Subscription sources, then WARP, then Free)
  const proxy = this.getBestAvailableProxy();
  if (proxy) this.activeLeases.set(taskId, proxy);
  return proxy;
}
```

- [ ] **Step 4: Implement `releaseProxy(taskId, success, reason)`**
Implementation concept:
```typescript
public releaseProxy(taskId: string, success: boolean, reason?: string) {
  const proxy = this.activeLeases.get(taskId);
  if (!proxy) return;
  this.activeLeases.delete(taskId);
  
  if (success) {
    proxy.stats.score = Math.min(100, proxy.stats.score + 10);
  } else {
    // Penalize heavily for IP blocks, lightly for timeouts
    const penalty = reason === 'ip_blocked' ? 30 : 10;
    proxy.stats.score = Math.max(0, proxy.stats.score - penalty);
  }
}
```

- [ ] **Step 5: Prioritize Subscription Sources**
Modify the proxy selection logic (likely in `getProxy` or wherever it sorts by score) to boost the score of Tier 1/2 proxies (WARP and Subscription sources) over ProxiflyCDN.

- [ ] **Step 6: Commit changes**
Commit message: "feat(proxy): implement sticky session lease and feedback loop API"
