# TG3: Data Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist successful account registrations and track proxy quality scores across application restarts to build a resilient, learning system.

**Architecture:** Use `electron-store` or lowdb (since this is an Electron backend) to maintain two collections: `accounts` and `proxy_scores`. When `TaskOrchestrator` succeeds, it saves the credentials and token to `accounts`. When `ProxyPoolService` updates a score, it persists it so bad proxies aren't immediately retried on reboot.

**Tech Stack:** TypeScript, Node.js, JSON Storage (electron-store / simple fs)

---

### Task 1: Implement Account and Proxy Storage Services

**Files:**
- Create: `d:\Desktop\cursor\nirvana-rebuild\electron\services\StorageService.ts`
- Modify: `d:\Desktop\cursor\nirvana-rebuild\electron\services\ProxyPoolService.ts`
- Modify: `d:\Desktop\cursor\nirvana-rebuild\electron\services\registration\TaskOrchestrator.ts`

- [ ] **Step 1: Create `StorageService.ts`**
Create a simple, synchronous JSON-backed storage utility using Node's `fs` (or whatever DB mechanism is currently available in the project). It should expose:
```typescript
interface RegistrationRecord {
  platform: string;
  email: string;
  password?: string;
  token?: string;
  proxyIp: string;
  timestamp: number;
}
export class StorageService {
  static saveAccount(record: RegistrationRecord): void;
  static getAllAccounts(): RegistrationRecord[];
  
  static saveProxyScore(ip: string, score: number): void;
  static loadProxyScores(): Record<string, number>;
}
```

- [ ] **Step 2: Hook up `TaskOrchestrator` to `StorageService`**
When `PipelineFactory.run()` returns a successful credential/token payload, map it to a `RegistrationRecord` and call `StorageService.saveAccount()`.

- [ ] **Step 3: Hook up `ProxyPoolService` to `StorageService`**
On startup, `ProxyPoolService` should read historical proxy scores and apply them to newly scraped/fetched proxies (so a proxy that was banned yesterday isn't treated as fresh today). When a score changes, persist it.

- [ ] **Step 4: Commit changes**
Commit message: "feat(storage): implement persistence for accounts and proxy statistics"
