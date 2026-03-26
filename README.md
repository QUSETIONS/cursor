<p align="center">
  <img src="https://img.shields.io/badge/Nirvana-v3.0-blueviolet?style=for-the-badge&logo=electron&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Electron-30-9feaf9?style=for-the-badge&logo=electron&logoColor=black" />
  <img src="https://img.shields.io/badge/React-18-61dafb?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ed?style=for-the-badge&logo=docker&logoColor=white" />
</p>

<h1 align="center">🔮 Nirvana — AI 无限续杯引擎</h1>

<p align="center">
  <b>全自动多平台 AI 账户注册 · 代理池管理 · CAPTCHA 破解 · Token 网关</b><br/>
  <sub>Built for resilience. Engineered for scale. Designed for stealth.</sub>
</p>

---

## 📋 目录

- [项目概览](#-项目概览)
- [系统架构](#-系统架构)
- [核心模块](#-核心模块)
- [支持平台](#-支持平台)
- [快速开始](#-快速开始)
- [环境变量](#-环境变量)
- [项目结构](#-项目结构)
- [CLI 脚本工具箱](#-cli-脚本工具箱)
- [Docker 部署](#-docker-部署)
- [技术栈](#-技术栈)
- [安全说明](#-安全说明)

---

## 🌟 项目概览

Nirvana 是一套完整的 **AI 服务账户全自动注册基础设施**，能够在无人值守的情况下完成从邮箱生成、CAPTCHA 破解、短信验证、账户注册到 Token 提取的全链路自动化。

### 核心能力

| 能力 | 描述 |
|------|------|
| 🎯 **多平台注册** | 支持 Cursor、OpenAI、Claude、Kiro、Windsurf、Antigravity 六大平台 |
| 🛡️ **CAPTCHA 破解** | 内置 Turnstile / Arkose Labs / DataDome 三大验证码解决方案 |
| 👻 **Ghost Fleet 代理池** | 自动采集、评分、轮换数千个代理节点，支持本地订阅路由器对接 |
| 📧 **无限邮箱矩阵** | Catch-All 域名路由 + IMAP 自动验证码提取，支持 MoeMail / mail.tm / addy.io |
| 📱 **短信验证自动化** | 集成 SMS-Activate / 5sim API，自动租用号码并提取验证码 |
| 🔄 **加特林韧性引擎** | 自动重试、代理轮换、断点续跑，单次任务最高容忍 3 轮代理失败 |
| 🖥️ **桌面 GUI 控制台** | 基于 Electron + React 的全功能可视化管理界面 |
| 🐳 **容器化部署** | Docker Compose 多容器编排，支持农场模式批量扩展 |

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Nirvana Desktop GUI (Electron + React)       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │Dashboard │ │注册面板  │ │账号池    │ │ 设置 / 管理面板  │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───────┬──────────┘   │
│       └────────────┼───────────┼────────────────┘               │
│                    │     IPC Channels                            │
├────────────────────┼────────────────────────────────────────────┤
│              Electron Main Process                               │
│  ┌─────────────────┴──────────────────────────┐                 │
│  │         Registration Pipeline               │                 │
│  │  ┌────────────────────────────────────┐     │                 │
│  │  │     Concurrent Scheduler           │     │                 │
│  │  │  (Retry · Proxy Rotation · Resume) │     │                 │
│  │  └──────────┬─────────────────────────┘     │                 │
│  │             │                                │                 │
│  │  ┌──────────▼──────────────────────────┐    │                 │
│  │  │    Platform Strategy Factory         │    │                 │
│  │  │  Cursor │ OpenAI │ Claude │ Kiro     │    │                 │
│  │  │  Windsurf │ Antigravity              │    │                 │
│  │  └─────────────────────────────────────┘    │                 │
│  └─────────────────────────────────────────────┘                 │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ Email Service │ │ The Foundry  │ │   Ghost Fleet Proxy Pool │ │
│  │ IMAP/MoeMail │ │ CAPTCHA API  │ │  Auto-scrape · Score     │ │
│  │ mail.tm/addy │ │ Turnstile    │ │  Rotate · Mihomo Hook    │ │
│  │ CF Worker    │ │ Arkose/DD    │ │  WARP · Subscription     │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  External APIs: SMS-Activate · Sub2API Gateway · IMAP Servers   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🧩 核心模块

### 1. 🚀 注册流水线 (Registration Pipeline)

流水线引擎是系统的心脏，基于 **策略模式** 实现多平台适配：

```
RegistrationPipeline
  ├── ConcurrentScheduler    # 并发调度器，支持 N 并行 + 自动重试
  ├── PipelineFactory        # 平台策略工厂，根据目标自动选择注册流程
  ├── ProgressTracker        # 实时进度跟踪与 UI 推送
  └── PluginRegistry         # 插件注册表，支持扩展
```

**韧性机制**：
- 🔄 代理失败自动轮换（`ERR_PROXY_CONNECTION_FAILED` → 释放坏节点 → 获取新代理 → 断点续跑）
- 🎯 可配置重试次数（默认 3 轮）
- 📊 实时遥测日志推送至 GUI 控制台

### 2. 👻 Ghost Fleet 代理池

```
ProxyPoolService (36KB — 系统最大模块)
  ├── ProxyAcquisitionService   # 自动从公开源抓取代理
  ├── ProxyGateway              # 统一网关出口
  ├── SubscriptionProxySource   # 对接付费订阅源
  └── System Proxy Hook         # 自动检测本地 Mihomo/Clash 路由
```

**特性**：
- 🏆 质量评分系统（0-100），每次请求优先分配高分节点
- 🔌 自动探测 Windows 注册表 `ProxyServer` 键值，零配置对接本地订阅路由器
- 🌍 支持 HTTP / HTTPS / SOCKS5 协议混合池
- 📈 Sticky Session 支持，同一注册流程锁定同一出口 IP

### 3. 🏭 The Foundry — CAPTCHA 破解引擎

| 解决方案 | 目标平台 | 技术路线 |
|----------|----------|----------|
| `TurnstileSolver` | Cursor, Kiro | CDP 伪装 + Canvas/WebGL 噪声 + PoW 计算 |
| `ArkoseSolver` | OpenAI | FunCaptcha Token 注入 |
| `DataDome Bypass` | Claude | Bezier 曲线鼠标轨迹 + 打字节奏模拟 |

- 本地 HTTP 服务 `POST /v1/solve`，兼容商业 CAPTCHA 服务 API 签名
- 极限隐身浏览器上下文（CDP 检测规避、navigator 指纹覆写）

### 4. 📧 邮箱服务矩阵

| 类型 | 适用场景 | 特点 |
|------|----------|------|
| **Catch-All IMAP** | 生产环境主力 | 自有域名，无限别名，Gmail App Password 读取 |
| **MoeMail** | 快速原型 | 基于 Cloudflare Workers |
| **mail.tm** | 无需配置 | 免费 REST API 临时邮箱 |
| **addy.io** | 免域名方案 | 免费 Catch-All 子域名别名 |
| **CF Worker** | 自建方案 | 基于 cloudflare_temp_email |

### 5. 🖥️ GUI 控制台

9 个功能页面的全功能桌面管理界面：

| 页面 | 功能 |
|------|------|
| `DashboardPage` | 系统总览仪表盘，实时指标 |
| `RegistrationPage` | Cursor 注册任务控制台 |
| `KiroRegisterPage` | Kiro 注册面板 |
| `WindsurfRegisterPage` | Windsurf 注册面板 |
| `AccountPoolPage` | 注册账号池管理 |
| `SwitchAccountPage` | 一键切换账号 |
| `OutlookToolboxPage` | Outlook 邮箱工具箱 |
| `AdminDashboardPage` | Sub2API 网关管理 |
| `SettingsPage` | 系统全局设置 |

---

## 🎯 支持平台

| 平台 | 注册策略 | CAPTCHA | 验证方式 | 状态 |
|------|----------|---------|----------|------|
| **Cursor** | `RegistrationSteps.ts` | Turnstile | 邮箱验证码 | ✅ 生产就绪 |
| **OpenAI** | `OpenAISteps.ts` | Arkose Labs | 邮箱 + 短信 | ✅ 已实现 |
| **Claude** | `ClaudeSteps.ts` | DataDome | 邮箱 + 短信 (US SIM) | ✅ 已实现 |
| **Kiro** | `KiroSteps.ts` | Turnstile | 邮箱验证码 | ✅ 已实现 |
| **Windsurf** | `WindsurfSteps.ts` | Turnstile | 邮箱验证码 | ✅ 已实现 |
| **Antigravity** | `AntigravitySteps.ts` | Google OAuth | OAuth 令牌注入 | ✅ 已实现 |

---

## 🚀 快速开始

### 前置条件

- **Node.js** ≥ 18
- **pnpm** 或 **npm**
- **Chrome** 浏览器（Puppeteer 需要）
- （可选）代理客户端：**Mihomo / Clash / v2rayN**，系统会自动检测

### 安装

```bash
# 克隆仓库
git clone https://github.com/QUSETIONS/cursor.git
cd cursor

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入你的 Gmail App Password 等凭据
```

### 启动

```bash
# 开发模式（带 GUI）
npm run dev

# 生产构建
npm run build
```

### CLI 模式（无 GUI）

```bash
# 直接运行注册脚本
npx tsx scripts/run_registration_pro.ts

# 启动代理池
npx tsx scripts/boot_proxy_pool.ts

# 测试 Catch-All 邮件路由
npx tsx scripts/test_catchall.ts
```

---

## 🔐 环境变量

在项目根目录创建 `.env` 文件（参考 `.env.example`）：

```env
# Catch-All 域名
CATCH_ALL_DOMAIN=your-domain.com

# IMAP 配置（推荐 Gmail App Password）
IMAP_USER=your-email@gmail.com
IMAP_PASS=your-gmail-app-password
IMAP_HOST=imap.gmail.com
IMAP_PORT=993

# Sub2API 网关密钥（可选）
SUB2API_API_KEY=

# Watchdog 告警 Webhook（可选）
WATCHDOG_WEBHOOK_URL=
```

> 💡 **Gmail App Password 获取方式**：Google 账户 → 安全性 → 两步验证 → 应用专用密码

---

## 📁 项目结构

```
nirvana/
├── electron/                    # Electron 主进程
│   ├── main.ts                  # 应用入口 & 代理自动检测
│   ├── preload.ts               # 渲染进程预加载
│   ├── engine/                  # 🚀 注册引擎核心
│   │   ├── RegistrationPipeline.ts   # 流水线主控
│   │   ├── ConcurrentScheduler.ts    # 并发调度 + 重试
│   │   ├── PipelineFactory.ts        # 平台策略工厂
│   │   ├── PluginRegistry.ts         # 插件系统
│   │   ├── ProgressTracker.ts        # 进度追踪
│   │   ├── steps/                    # 平台注册步骤
│   │   │   ├── RegistrationSteps.ts  #   Cursor
│   │   │   ├── OpenAISteps.ts        #   OpenAI
│   │   │   ├── ClaudeSteps.ts        #   Claude
│   │   │   ├── KiroSteps.ts          #   Kiro
│   │   │   ├── WindsurfSteps.ts      #   Windsurf
│   │   │   └── AntigravitySteps.ts   #   Antigravity
│   │   └── plugins/                  # 引擎插件
│   ├── services/                # 🔧 服务层
│   │   ├── EmailServiceFactory.ts    # 多源邮箱工厂
│   │   ├── ImapService.ts            # IMAP 验证码提取
│   │   ├── ProxyPoolService.ts       # Ghost Fleet 代理池
│   │   ├── ProxyAcquisitionService.ts# 代理采集
│   │   ├── CaptchaSolverService.ts   # CAPTCHA 对接
│   │   ├── BrowserService.ts         # 反指纹浏览器
│   │   ├── IPSwitchService.ts        # IP 轮换
│   │   ├── SmsService.ts             # 短信验证
│   │   ├── AccountPoolService.ts     # 账号池管理
│   │   ├── ApiGateway.ts             # Sub2API 网关
│   │   ├── TokenRefreshService.ts    # Token 刷新
│   │   ├── WatchdogService.ts        # 系统监控
│   │   ├── solver/                   # 🏭 The Foundry
│   │   │   ├── SolverServer.ts       #   本地 CAPTCHA API
│   │   │   ├── TurnstileSolver.ts    #   Turnstile 破解
│   │   │   └── ArkoseSolver.ts       #   Arkose 破解
│   │   ├── proxy/                    # 代理网关
│   │   ├── registration/             # 注册编排
│   │   └── base/                     # BaseService / RetryPolicy
│   ├── ipc/                     # IPC 通道定义
│   ├── security/                # 安全模块
│   └── utils/                   # 工具类
├── src/                         # 🖥️ React 前端
│   ├── App.tsx                  # 路由入口
│   ├── index.css                # 设计系统 (暗色主题)
│   ├── pages/                   # 9 个功能页面
│   ├── stores/                  # Zustand 状态管理
│   └── types/                   # 共享类型定义
├── scripts/                     # 🛠️ CLI 工具
│   ├── run_registration_pro.ts  # 生产注册 CLI
│   ├── boot_proxy_pool.ts       # 代理池启动
│   ├── test_catchall.ts         # Catch-All 测试
│   ├── test_antigravity.ts      # Antigravity 测试
│   └── ...                      # 更多工具脚本
├── docker/                      # Docker 配置
├── docker-compose.farm.yml      # 农场批量容器
├── docker-compose.proxy-stack.yml # 代理栈
├── docker-compose.warp.yml      # WARP 矩阵
├── docs/                        # 文档
├── .env.example                 # 环境变量模板
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🛠️ CLI 脚本工具箱

| 脚本 | 用途 | 命令 |
|------|------|------|
| `run_registration_pro.ts` | 生产级注册 CLI | `npx tsx scripts/run_registration_pro.ts` |
| `boot_proxy_pool.ts` | 启动完整代理池 | `npx tsx scripts/boot_proxy_pool.ts` |
| `boot_full_proxy_pool.ts` | 全量代理池（含订阅源） | `npx tsx scripts/boot_full_proxy_pool.ts` |
| `test_catchall.ts` | 测试 Catch-All 邮件路由 | `npx tsx scripts/test_catchall.ts` |
| `test_antigravity.ts` | 测试 Antigravity 流程 | `npx tsx scripts/test_antigravity.ts` |
| `test_openai_reg.ts` | 测试 OpenAI 注册 | `npx tsx scripts/test_openai_reg.ts` |
| `test_claude_reg.ts` | 测试 Claude 注册 | `npx tsx scripts/test_claude_reg.ts` |
| `start_solver.ts` | 启动 CAPTCHA Solver | `npx tsx scripts/start_solver.ts` |
| `start_proxy_gateway.ts` | 启动代理网关 | `npx tsx scripts/start_proxy_gateway.ts` |
| `deploy_wireproxy_warp.ts` | 部署 WireProxy WARP | `npx tsx scripts/deploy_wireproxy_warp.ts` |

---

## 🐳 Docker 部署

### 农场模式（批量注册）

```bash
# 配置 .env 后启动
docker compose -f docker-compose.farm.yml up -d --scale worker=5
```

### 代理栈

```bash
docker compose -f docker-compose.proxy-stack.yml up -d
```

### WARP 代理矩阵

```bash
docker compose -f docker-compose.warp.yml up -d
```

---

## 🔧 技术栈

| 层级 | 技术 |
|------|------|
| **桌面框架** | Electron 30 |
| **前端** | React 18 + Zustand + Lucide Icons |
| **后端** | TypeScript 5.7 + Express 5 |
| **构建** | Vite 6 + electron-builder |
| **浏览器自动化** | Puppeteer + puppeteer-extra-plugin-stealth |
| **邮件协议** | IMAP (node-imap) + mailparser |
| **数据库** | better-sqlite3 |
| **代理协议** | HTTP / HTTPS / SOCKS5 (socks) |
| **容器化** | Docker + Docker Compose |
| **凭据存储** | keytar (OS 密钥链) + dotenv |

---

## 🔒 安全说明

- 🚫 **所有凭据** 均通过 `.env` 文件管理，**已从代码中完全移除**
- 🔑 `.env` 文件已被 `.gitignore` 排除，**不会被提交到 Git**
- 📋 `.env.example` 仅包含占位符，可安全提交
- 🛡️ 敏感操作使用 `keytar` 集成操作系统密钥链
- ⚠️ **请确保此仓库设置为 Private**

---

## 📄 License

Private — Internal Use Only.

---

<p align="center">
  <sub>Engineered with 🔮 by Nirvana Team · 2026</sub>
</p>
