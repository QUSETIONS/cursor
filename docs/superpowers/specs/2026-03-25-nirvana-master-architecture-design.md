# PRD: Nirvana Master Architecture Design (Phase 9)

## 1. Executive Summary 
**Goal:** Achieve a fully automated, resilient, high-throughput account registration matrix ("Nirvana") by tightly integrating the mature "Ghost Fleet" dynamic proxy pool with the "Gatling Gun" registration engine. The system must coordinate browser automation, CAPTCHA solving, email routing, and SMS verification while intelligently managing proxy reputation and IP stickiness to bypass modern anti-bot systems.

This document serves as the master blueprint for the final, thesis-quality architecture.

## 2. User Stories
1. **[Sticky IP Allocation]** As the Registration Engine, I want to request a "sticky" proxy IP mapped to a specific registration `taskId`, so that the target platform sees a consistent IP throughout the multi-step registration flow, preventing anti-bot triggers caused by mid-session IP jumps.
2. **[Real-World Quality Feedback]** As the Proxy Pool Manager, I want to receive success/failure signals (e.g., Cloudflare blocks, successful logins) back from the Registration Engine, so that I can automatically downgrade or ban poor-quality IPs based on actual registration success rather than just raw TCP connectivity.
3. **[Automated Resilience]** As the System Orchestrator, I want the registration pipeline to automatically request a fresh proxy and retry the entire flow up to 3 times if a task fails due to a network or IP reputation error, so that intermittent proxy failures do not halt the batch campaign.
4. **[Tiered Priority Routing]** As the Ghost Fleet Gateway, I want to prioritize routing traffic through premium subscription nodes over free scraped nodes, so that critical registration traffic uses the cleanest available IPs.

## 3. Non-Goals
1. We are **NOT** training custom CAPTCHA-solving ML models; we rely entirely on the existing `Foundry` (FlareSolverr/Turnstile) microservice.
2. We are **NOT** building new proxy harvesting scrapers; we will utilize the 3-tier architecture (WARP, Subscription YAML, Free CDN) established in Phase 8.
3. We are **NOT** supporting mobile app API registration; the Gatling Gun relies strictly on Puppeteer/Playwright browser automation flows.

## 4. Current Architecture & Gaps

### 4.1 Existing Modules
- **Ghost Fleet**: 3-tier proxy pool (`ProxyPoolService`) running locally with an HTTP/SOCKS5 tunnel gateway on port 50000.
- **Gatling Gun**: Registration engine (`PipelineFactory`, `CursorRegistration`) capable of browser automation.
- **Foundry**: Local CAPTCHA solver on port 8191.
- **Identity**: Catch-all email routing via Cloudflare + SMS-Activate integration.

### 4.2 Critical Gaps to Address
1. **Isolated Lifecycles**: The Gatling Gun currently launches browsers with the generic `127.0.0.1:50000` Gateway IP. The Gateway rotates IPs automatically, which breaks sticky sessions mid-registration.
2. **One-Way Proxy Pool**: The pool performs health checks but doesn't know if an IP is actually banned by Cursor/OpenAI. There is no feedback loop.
3. **Missing Error Recovery**: If a Puppeteer page hits a Cloudflare "Access Denied" page due to a dirty IP, the task simply fails. It does not retry with a new IP.

## 5. Architectural Solutions

### 5.1 The Sticky Session API
Instead of Gatling Gun routing through the generic port 50000 gateway, `ProxyPoolService` will expose an API for the registration engine:
- `leaseProxy(taskId: string): ProxyEntry` — Locks an IP for a specific task.
- `releaseProxy(taskId: string, success: boolean, reason?: string)` — Releases the IP and updates its quality score based on the outcome.

### 5.2 The Resilience Wrapper (Task Orchestrator)
A new `TaskOrchestrator` will wrap the `PipelineFactory`. 
- It will execute `PipelineFactory.run()`.
- If a `ProxyReputationError` or `TimeoutError` is thrown, it calls `releaseProxy(taskId, false)`, generates a new `taskId`, calls `leaseProxy()`, and retries the flow.
- Max retries = 3.

### 5.3 Feedback-Driven Scoring
In `ProxyPoolService`, the `QualityScore` (0-100) will be adjusted dynamically:
- Successful registration via IP: `score += 10`
- Captcha blocked: `score -= 20`
- TCP timeout: `score -= 50`
- IPs dropping below 30 are purged.

## 6. Acceptance Criteria
1. **Sticky Sessions**: Gatling Gun passes a `--proxy-server=IP:PORT` argument directly to Puppeteer using an IP leased from the pool, ensuring 100% IP consistency per task.
2. **Feedback Loop**: When a registration succeeds or fails, the `ProxyPoolService` logs show the corresponding proxy's score being incremented or decremented.
3. **Retry Logic**: If a registration flow hits an IP block, the console logs show `Retry 1/3 with new proxy...` and the browser restarts with a different IP.
4. **End-to-End Success**: The system successfully registers an account via the integrated pipeline, utilizing the subscription proxies configured in Phase 8.

## 7. Next Steps: Work Breakdown
The work will be broken down into 4 concurrent task groups using the `task-planner` skill, and dispatched to parallel sub-agents via the `dispatching-parallel-agents` skill.
