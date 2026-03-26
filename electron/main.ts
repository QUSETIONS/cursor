const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { IpcBus } from './ipc/IpcBus';
import { Channels } from './ipc/channels';
import { SecureStorage } from './security/SecureStorage';
import { SessionManager } from './security/SessionManager';
import { ImapService } from './services/ImapService';
import { createEmailService } from './services/EmailServiceFactory';
import { BrowserService } from './services/BrowserService';
import { IPSwitchService } from './services/IPSwitchService';
import { RegistrationPipeline } from './engine/RegistrationPipeline';
import { AccountPoolService } from './services/AccountPoolService';
import { ProxyPoolService, ProxiflyCDNSource, PublicPoolSource, ProxyTunnelGateway } from './services/ProxyPoolService';
import { StorageService } from './services/StorageService';
import { CursorSwitchService } from './services/CursorSwitchService';
import { TokenRefreshService } from './services/TokenRefreshService';
import { ApiGateway } from './services/ApiGateway';
import { WatchdogService } from './services/WatchdogService';
import { OutlookService } from './services/OutlookService';
import { Logger, logEmitter } from './utils/Logger';
import { startSolverServer } from './services/solver/SolverServer';

const logger = Logger.create('Main');

// ─── Zombie Process Cleanup for Docker Headless Environment ───
function forceKillChromium() {
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' });
    } else {
      execSync('pkill -f chrom', { stdio: 'ignore' });
    }
    logger.info('Cleaned up orphan Chromium processes gracefully');
  } catch (e) {
    // Ignore if none found
  }
}

// ─── Prevent EPIPE from crashing the main process ───
// When Electron's renderer closes or restarts, stdout/stderr pipes can break.
// Without this handler, any console.log during proxy scraping etc. kills the app.
process.stdout?.on?.('error', (err: any) => {
  if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') return;
  throw err; // re-throw non-pipe errors
});
process.stderr?.on?.('error', (err: any) => {
  if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') return;
  throw err;
});

process.on('SIGTERM', () => {
  logger.warn('Received SIGTERM, purging Chromium zombies and shutting down...');
  forceKillChromium();
  app.quit();
});
process.on('SIGINT', () => {
  logger.warn('Received SIGINT, purging Chromium zombies and shutting down...');
  forceKillChromium();
  app.quit();
});

// ─── Global state ───
let mainWindow: any = null;
let globalProxyConfig: any = null;

async function applyGlobalProxy(proxy: any) {
  if (!proxy || proxy.type === 'none' || !proxy.host || !proxy.port) {
    await session.defaultSession.setProxy({ proxyRules: 'direct://' });
    logger.info('Global Proxy disabled (direct connection)');
    return;
  }
  
  const rules = `${proxy.type}://${proxy.host}:${proxy.port}`;
  await session.defaultSession.setProxy({ proxyRules: rules });
  logger.info(`Global Proxy enabled: ${rules}`);
}

app.on('login', (event: any, webContents: any, request: any, authInfo: any, callback: any) => {
  if (authInfo.isProxy && globalProxyConfig && globalProxyConfig.user && globalProxyConfig.pass) {
    event.preventDefault();
    callback(globalProxyConfig.user, globalProxyConfig.pass);
  }
});
const ipcBus = new IpcBus();
const secureStorage = new SecureStorage(app.getPath('userData'));
const sessionManager = new SessionManager();
const imapService = new ImapService();
const browserService = new BrowserService();
browserService.setConfig({ type: 'local', headless: false });  // Default: launch local Chrome
const ipService = new IPSwitchService();

const dbPath = path.join(app.getPath('userData'), 'nirvana_data');
const accountPool = new AccountPoolService(dbPath);
export const proxyPool = new ProxyPoolService({ strategy: 'quality', autoPurge: true, fastLaneSize: 3 });

// Register built-in proxy sources
proxyPool.addSource(new ProxiflyCDNSource());      // Free CDN proxy lists
proxyPool.addSource(new PublicPoolSource());        // Public ProxyPool instances

// Local tunnel gateway — tools connect to 127.0.0.1:10801
const proxyTunnel = new ProxyTunnelGateway(proxyPool, 10801, '127.0.0.1', 10);

// Auto-import verified proxies if the file exists
const verifiedProxyPath = path.join(__dirname, '..', 'data', `verified_proxies_${new Date().toISOString().slice(0, 10)}.txt`);
try {
  if (fs.existsSync(verifiedProxyPath)) {
    const proxyText = fs.readFileSync(verifiedProxyPath, 'utf-8');
    const { imported } = proxyPool.importProxies(proxyText);
    logger.info(`Pre-loaded ${imported} verified proxies from ${verifiedProxyPath}`);
  }
} catch (e) {
  logger.warn('Could not pre-load verified proxies:', e);
}

// ─── Local System Proxy Integration (Mihomo / Clash / v2ray) ───
// Chinese users invariably run local subscription routers. We hook into them directly.
// This completely bypasses the ERR_PROXY_CONNECTION_FAILED from dead free nodes.
const systemPorts = [7897, 7890, 10808, 1080, 10809];
for (const port of systemPorts) {
  proxyPool.addProxy({
    protocol: port === 7897 ? 'http' : 'socks5', // HTTP works universally
    host: '127.0.0.1',
    port,
    provider: 'Local Router (Mihomo/Clash)',
    country: 'local',
    enabled: true,
    activeConnections: 0,
    lastUsedAt: 0,
    ipv6Capable: true,
    qualityScore: 100, // Top priority
    source: 'local-mihomo',
  });
}
logger.info(`Injected local premium routing proxies (Clash/Mihomo) on ports: ${systemPorts.join(', ')}`);
const cursorSwitch = new CursorSwitchService();
const tokenService = new TokenRefreshService();
const apiGateway = new ApiGateway(tokenService);

// Telemetry Watchdog
const watchdog = new WatchdogService(accountPool, proxyPool, {
  alertWebhookUrl: process.env.WATCHDOG_WEBHOOK_URL,
});

// Use Catch-All IMAP for reliable verification code retrieval
const emailService = createEmailService({
  type: 'imap',
  imapUser: process.env.IMAP_USER || '',
  imapPass: process.env.IMAP_PASS || '',
  imapHost: process.env.IMAP_HOST || 'imap.gmail.com',
  imapPort: Number(process.env.IMAP_PORT) || 993,
});
const registrationPipeline = new RegistrationPipeline(browserService, ipService, emailService);
const outlookService = new OutlookService(browserService);

// ─── Window creation ───
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: '无忧小助手 v3.0',
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f23',
  });

  // Show when ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load content
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Set pipeline window for progress push
  registrationPipeline.setWindow(mainWindow);

  // Window maximize change event
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(Channels.WINDOW_MAXIMIZE_CHANGE, true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(Channels.WINDOW_MAXIMIZE_CHANGE, false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Register IPC Handlers ───
function registerIpcHandlers(): void {
  // ── Window controls ──
  ipcBus.handle(Channels.WINDOW_MINIMIZE, async () => mainWindow?.minimize());
  ipcBus.handle(Channels.WINDOW_MAXIMIZE, async () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcBus.handle(Channels.WINDOW_CLOSE, async () => mainWindow?.close());
  ipcBus.handle(Channels.APP_GET_VERSION, async () => app.getVersion());
  ipcBus.handle(Channels.APP_GET_PLATFORM, async () => process.platform);

  // ── Secure Storage ──
  ipcBus.handle(Channels.STORAGE_GET, async (_e, key: unknown) => {
    return secureStorage.get(String(key));
  });
  ipcBus.handle(Channels.STORAGE_SET, async (_e, key: unknown, value: unknown) => {
    await secureStorage.set(String(key), value);
    return true;
  });
  ipcBus.handle(Channels.STORAGE_DELETE, async (_e, key: unknown) => {
    await secureStorage.delete(String(key));
    return true;
  });

  // ── Engine Dashboard (Foundry / Ghost Fleet) ──
  let isFoundryRunning = false;
  ipcBus.handle(Channels.ENGINE_FOUNDRY_START, async () => {
    if (isFoundryRunning) return { success: true, message: 'Already running' };
    try {
      // In a real production app we'd spawn a child process to avoid blocking the main event loop,
      // but the Express server is very lightweight.
      startSolverServer();
      isFoundryRunning = true;
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcBus.handle(Channels.ENGINE_FOUNDRY_STATUS, async () => {
    return { running: isFoundryRunning, port: 8191 };
  });

  let isGhostFleetRunning = true; // Started by default in main.ts
  ipcBus.handle(Channels.ENGINE_GHOSTFLEET_START, async () => {
    if (isGhostFleetRunning) return { success: true };
    try {
       proxyPool.start();
       await proxyTunnel.start();
       isGhostFleetRunning = true;
       return { success: true };
    } catch (e: any) {
       return { success: false, error: e.message };
    }
  });

  ipcBus.handle(Channels.ENGINE_GHOSTFLEET_STOP, async () => {
    proxyPool.stop();
    await proxyTunnel.stop();
    isGhostFleetRunning = false;
    return { success: true };
  });

  ipcBus.handle(Channels.ENGINE_GHOSTFLEET_STATUS, async () => {
    const stats = proxyPool.getStats ? proxyPool.getStats() : { total: proxyPool.listProxies().length, fastLaneCount: 0 };
    return {
      running: isGhostFleetRunning,
      port: 10801, // ProxyTunnel Gateway Port
      totalProxies: stats.total,
      fastLaneCount: stats.fastLaneCount
    };
  });

  // ── TG4: Ghost Fleet Metrics & Gatling Gun History ──
  ipcBus.handle('get-proxy-stats', async () => {
    const all = proxyPool.listProxies();
    const healthy = all.filter(p => p.isHealthy && p.enabled);
    return {
      total: all.length,
      healthy: healthy.length,
      topNodes: healthy.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 5)
    };
  });

  ipcBus.handle('get-recent-accounts', async () => {
    return StorageService.getAllAccounts().slice(-10);
  });

  // Connect global unified logging to frontend terminal
  logEmitter.on('log', (msg) => {
    mainWindow?.webContents.send(Channels.ENGINE_GLOBAL_LOG, msg);
  });

  // ── IMAP ──
  ipcBus.handle(Channels.IMAP_TEST, async (_e, config: unknown) => {
    return imapService.testConnection(config as any);
  });

  // ── File system ──
  ipcBus.handle(Channels.FS_READ_FILE, async (_e, filePath: unknown) => {
    try {
      return fs.readFileSync(String(filePath), 'utf-8');
    } catch {
      return null;
    }
  });
  ipcBus.handle(Channels.DIALOG_SELECT_FILE, async (_e, options: unknown) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      ...(options as any),
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcBus.handle(Channels.DIALOG_SELECT_DIR, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // ── Registration Engine ──
  ipcBus.handle(Channels.REGISTER_START, async (_e, params: unknown) => {
    try {
      const p = params as any;
      // Auto-default to 'local' browser mode if not configured
      if (!p.browserConfig || !p.browserConfig.type) {
        p.browserConfig = { type: 'local', headless: false, ...(p.browserConfig || {}) };
      }
      const results = await registrationPipeline.execute(p);
      return { success: true, results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  
  ipcBus.handle(Channels.REGISTER_AUTO, async (_e, params: any) => {
    try {
      const count = params?.count || 5;
      const emails: string[] = [];
      const platformStr = params?.platform || 'cursor';

      // 1. Auto generate emails using the default MoeMail/MailTm service
      for (let i = 0; i < count; i++) {
        try {
          const temp = await emailService.createEmail();
          emails.push(temp.address);
        } catch (e) {
          logger.warn('Failed to pre-create email for auto-register:', e);
        }
      }

      if (emails.length === 0) {
        throw new Error('Could not auto-generate any emails');
      }

      const p = {
        platform: platformStr,
        emails,
        imapAccounts: [],
        browserConfig: { type: 'local' as const, headless: false }, // Keep window visible so user can see what's happening
        ipConfig: { enabled: true, strategy: 'proxy' as const }, // Pipeline will allocate a unique IP per browser instance
        savePath: path.join(app.getPath('userData'), 'auto_accounts'),
        interval: 3,
        deleteMailAfterRead: true,
        fetchTokenAfterRegister: true,
        timeout: 120000,
        concurrency: 1
      };

      // 2. (Removed) Not wiring the app globally - we now inject isolated proxies per browser instance directly in the pipeline.

      // 3. Start pipeline
      const results = await registrationPipeline.execute(p);
      return { success: true, results };
    } catch (error) {
      logger.error('REGISTER_AUTO error:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcBus.on(Channels.REGISTER_STOP, () => {
    registrationPipeline.stop();
  });

  // ── Outlook Toolbox ──
  ipcBus.handle(Channels.OUTLOOK_REGISTER_START, async (_e, params: any) => {
    outlookService.registerBatch(params.count, params.prefix, params.password);
    return { success: true };
  });
  ipcBus.on(Channels.OUTLOOK_REGISTER_STOP, () => {
    outlookService.stop();
  });
  ipcBus.handle(Channels.OUTLOOK_FORWARD_SETUP, async (_e, params: any) => {
    outlookService.forwardSetupBatch(params.emails, params.targetEmail);
    return { success: true };
  });
  ipcBus.handle(Channels.OUTLOOK_VERIFY_START, async (_e, params: any) => {
    try {
      const results = await outlookService.verifyBatch(params.emails);
      return { success: true, results };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  outlookService.on('log', (msg) => {
    mainWindow?.webContents.send(Channels.OUTLOOK_LOG, msg);
  });
  outlookService.on('progress', (data) => {
    mainWindow?.webContents.send(Channels.OUTLOOK_VERIFY_PROGRESS, data);
  });

  // ── IP Switch ──
  ipcBus.handle(Channels.IP_SWITCH, async () => ipService.switchIP());
  ipcBus.handle(Channels.IP_GET_CURRENT, async () => ipService.getCurrentIP());
  ipcBus.handle(Channels.IP_HEALTH, async () => ipService.healthCheck());

  // ── Switch Account ──
  ipcBus.handle(Channels.SWITCH_RESET_MACHINE_ID, async (_e, token?: unknown) => 
    cursorSwitch.switchAccountAndIdentity(typeof token === 'string' ? token : undefined)
  );
  ipcBus.handle(Channels.SWITCH_DETECT_INSTALL, async () => cursorSwitch.healthCheck());

  // ── Browser ──
  ipcBus.handle(Channels.BROWSER_HEALTH, async () => browserService.healthCheck());

  // ── Account Pool ──
  ipcBus.handle(Channels.POOL_LIST, async (_e, filter: unknown) => accountPool.list(filter as any));
  ipcBus.handle(Channels.POOL_ADD, async (_e, account: unknown) => accountPool.addAccount(account as any));
  ipcBus.handle(Channels.POOL_REMOVE, async (_e, id: unknown) => accountPool.removeAccount(String(id)));
  ipcBus.handle(Channels.POOL_UPDATE, async (_e, id: unknown, updates: unknown) => accountPool.updateAccount(String(id), updates as any));
  ipcBus.handle(Channels.POOL_SYNC_REGPLATFORM, async (_e, params: any) => {
    // Sync all platforms we use
    const cursorRes = await accountPool.syncRegPlatform(params.url, params.token, 'cursor');
    const windsurfRes = await accountPool.syncRegPlatform(params.url, params.token, 'windsurf');
    const kiroRes = await accountPool.syncRegPlatform(params.url, params.token, 'kiro');
    
    if (cursorRes.error && !cursorRes.imported) {
      return { success: false, error: cursorRes.error };
    }
    const sum = (cursorRes.imported || 0) + (windsurfRes.imported || 0) + (kiroRes.imported || 0);
    return { success: true, imported: sum };
  });
  ipcBus.handle(Channels.POOL_PULL, async (_e, platform: unknown, plan: unknown) => accountPool.pullAccount(String(platform) as any, plan ? String(plan) : undefined));
  ipcBus.handle(Channels.POOL_STATS, async () => accountPool.getStats());

  // ── Proxy Pool v3 ──
  ipcBus.handle(Channels.PROXY_LIST, async () => proxyPool.listProxies());
  ipcBus.handle(Channels.PROXY_ADD, async (_e, proxy: unknown) => proxyPool.addProxy(proxy as any));
  ipcBus.handle(Channels.PROXY_REMOVE, async (_e, id: unknown) => proxyPool.removeProxy(String(id)));
  ipcBus.handle(Channels.PROXY_IMPORT, async (_e, text: unknown) => proxyPool.importProxies(String(text)));
  ipcBus.handle(Channels.PROXY_IMPORT_FILE, async (_e, filePath: unknown, protocol: unknown) => {
    return proxyPool.importFromFile(String(filePath), (protocol as any) || 'socks5');
  });
  ipcBus.handle(Channels.PROXY_EXPORT, async () => proxyPool.exportProxies());
  ipcBus.handle(Channels.PROXY_HEALTH_CHECK, async () => proxyPool.healthCheckAll());
  ipcBus.handle(Channels.PROXY_STATS, async () => proxyPool.getStats());
  ipcBus.handle(Channels.PROXY_FETCH_SOURCES, async () => proxyPool.fetchAllSources());
  ipcBus.handle(Channels.PROXY_LIST_SOURCES, async () => proxyPool.listSources());
  ipcBus.handle(Channels.PROXY_TUNNEL_INFO, async () => proxyTunnel.getInfo());
  ipcBus.handle(Channels.PROXY_REFRESH_FASTLANE, async () => { proxyPool.refreshFastLane(); return true; });

  // ─── Proxy Apply ───
  ipcBus.handle(Channels.PROXY_APPLY, async (_e, proxyConfig: unknown) => {
    globalProxyConfig = proxyConfig;
    await applyGlobalProxy(proxyConfig);
    return true;
  });

  logger.info('All IPC handlers registered');
}

// ─── App lifecycle ───
app.whenReady().then(async () => {
  logger.info('=== 无忧小助手 v3.0 启动 ===');

  // Initialize secure storage
  await secureStorage.initialize();

  // Load and apply global proxy
  try {
    const settings: any = await secureStorage.get('settings');
    if (settings && settings.proxy) {
      globalProxyConfig = settings.proxy;
      await applyGlobalProxy(settings.proxy);
    }
  } catch (e) {
    logger.error('Failed to load proxy config:', e);
  }

  // Initialize services
  await imapService.start();
  await browserService.start();
  await ipService.start();
  await accountPool.initialize();
  await cursorSwitch.start();
  tokenService.start();
  await apiGateway.start();
  proxyPool.start();
  proxyTunnel.start().catch((e: any) => logger.error('Tunnel gateway failed to start:', e));
  watchdog.start();

  // ─── Auto Sync Worker ───
  setInterval(async () => {
    try {
      const urlValue = await secureStorage.get('regplatform_url');
      const tokenValue = await secureStorage.get('regplatform_token');
      const url = typeof urlValue === 'string' ? urlValue : '';
      const token = typeof tokenValue === 'string' ? tokenValue : '';
      if (url && token) {
        logger.info('Auto Sync Worker: Checking for new accounts from RegPlatform...');
        const cursorRes = await accountPool.syncRegPlatform(url, token, 'cursor');
        const windsurfRes = await accountPool.syncRegPlatform(url, token, 'windsurf');
        const kiroRes = await accountPool.syncRegPlatform(url, token, 'kiro');
        const total = (cursorRes.imported || 0) + (windsurfRes.imported || 0) + (kiroRes.imported || 0);
        if (total > 0) {
          logger.info(`Auto Sync Worker: Imported ${total} new accounts silently.`);
        }
      }
    } catch (err) {
      logger.error('Auto Sync Worker error:', err);
    }
  }, 5 * 60 * 1000); // 5 minutes

  // Register IPC handlers
  registerIpcHandlers();
  
  // Create main window
  createWindow();

  // ─── AI AUTO-TEST INJECTION ───
  setTimeout(async () => {
    logger.info('🤖 [AI Test] Auto-triggering Gatling Gun on 1 account via Catch-All IMAP & Local Proxy (7897)...');
    try {
      const prefix = Math.random().toString(36).substring(2, 10);
      const catchAllDomain = process.env.CATCH_ALL_DOMAIN || 'nirvana-farm-2026.cyou';
      const tempEmail = `${prefix}@${catchAllDomain}`;
      logger.info(`🤖 [AI Test] Generated Catch-All target: ${tempEmail}`);
      
      const results = await registrationPipeline.execute({
        platform: 'cursor' as any,
        emails: [tempEmail],
        imapAccounts: [],
        browserConfig: { type: 'local' as const, headless: true },
        ipConfig: { strategy: 'proxy' as const },
        savePath: path.join(app.getPath('userData'), 'auto_accounts'),
        interval: 1,
        deleteMailAfterRead: true,
        fetchTokenAfterRegister: true,
        timeout: 120000,
        concurrency: 1,
        retryLimit: 3
      });
      logger.info('🤖 [AI Test] Finished! Results: ' + JSON.stringify(results, null, 2));
      setTimeout(() => app.quit(), 5000);
    } catch (err) {
      logger.error('🤖 [AI Test] Failed:', err);
      setTimeout(() => app.quit(), 5000);
    }
  }, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  logger.info('正在关闭...');
  ipcBus.dispose();
  proxyPool.stop();
  proxyTunnel.stop().catch(() => {});
  tokenService.stop();
  await apiGateway.stop();
  await browserService.stop();
  await imapService.stop();
  await ipService.stop();
});
