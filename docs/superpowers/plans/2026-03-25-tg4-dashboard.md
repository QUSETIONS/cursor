# TG4: Dashboard UI & Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide full visibility into the Ghost Fleet proxy pool and the Gatling Gun registration results by wiring the robust core metrics to the React Dashboard.

**Architecture:** Extend Electron IPC to stream Proxy Pool statistics (total count, top 5 proxy IPs with scores) and recent account registrations (from `StorageService`). Display these in dedicated status cards on the React dashboard.

**Tech Stack:** React, Tailwind CSS, Electron IPC

---

### Task 1: Extend IPC Handlers in Main Process

**Files:**
- Modify: `d:\Desktop\cursor\nirvana-rebuild\electron\main.ts`

- [ ] **Step 1: Expose Proxy Stats IPC**
Add an `ipcMain.handle` endpoint to return the current proxy pool statistics (how many proxies alive, average score, top 5 highest-scored proxies).
```typescript
ipcMain.handle('get-proxy-stats', async () => {
  return proxyPoolService.getStats();
});
```

- [ ] **Step 2: Expose Registration History IPC**
Add an `ipcMain.handle` endpoint to return recent registrations from `StorageService`.
```typescript
ipcMain.handle('get-recent-accounts', async () => {
  return StorageService.getAllAccounts().slice(-10); // Last 10
});
```

### Task 2: Build React UI Components

**Files:**
- Modify: `d:\Desktop\cursor\nirvana-rebuild\src\pages\DashboardPage.tsx`
- Modify: `d:\Desktop\cursor\nirvana-rebuild\src\electron.d.ts`

- [ ] **Step 1: Update TypeScript Definitions**
Update `electron.d.ts` to include the new IPC signatures for `getProxyStats` and `getRecentAccounts`.

- [ ] **Step 2: Build `<ProxyStatsCard />` Component**
Create a visual card (similar to existing server status cards) showing the proxy count. If count > 1000, show a green "Ghost Fleet Active" badge. Display a small table or list of the top 3 nodes and their `QualityScore`. Use `useInterval` or a polling Hook to refresh every 5 seconds.

- [ ] **Step 3: Build `<RecentRegistrationsCard />` Component**
Create a table showing the latest generated accounts, their target platform (Cursor/OpenAI), timestamp, and the masked proxy IP that was successfully used.

- [ ] **Step 4: Commit changes**
Commit message: "feat(ui): add real-time proxy fleet metrics and registration history to dashboard"
