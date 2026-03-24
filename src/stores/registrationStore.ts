import { create } from 'zustand';
import { Channels } from '../../electron/ipc/channels';

// ─── Types ───
export interface ImapAccount {
  id: string;
  email: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
  enabled: boolean;
  status?: 'unknown' | 'testing' | 'success' | 'fail';
}

export interface CatchAllConfig {
  enabled: boolean;
  domain: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPass: string;
  imapTls: boolean;
  targetCount: number;
}

export interface BrowserConfig {
  type: 'vb' | 'nstbrowser';
  cdpPort: number;
  vbDynamicEnv: boolean;
  vbApiKey: string;
  vbBaseURL: string;
  vbChromeVersion: number;
  vbGroupId: string;
  vbExecutablePath: string;
  nstApiKey: string;
  nstProfileId: string;
  nstUseOnceBrowser: boolean;
}

export interface ProxyConfig {
  enabled: boolean;
  strategy: 'adb' | 'clash' | 'zte' | 'system';
  adbPath: string;
  airplaneDuration: number;
  networkRecoverWait: number;
  clashApiUrl: string;
  clashApiSecret: string;
  clashProxyGroup: string;
  clashExcludeNodes: string;
  zteHost: string;
  ztePassword: string;
  switchEveryN: number;
  switchOnCloudflareN: number;
  switchOnFailN: number;
}

export interface ProgressState {
  current: number;
  total: number;
  success: number;
  fail: number;
  currentEmail: string;
  currentStep: string;
  stepProgress: number;
  estimatedTimeRemaining: number;
  errors: Array<{
    email: string;
    step: string;
    message: string;
    timestamp: number;
  }>;
}

// ─── Store ───
interface RegistrationStore {
  // Mode
  mode: 'imap' | 'bindcard';
  setMode: (mode: 'imap' | 'bindcard') => void;

  // Emails
  emails: string;
  setEmails: (emails: string) => void;
  deduplicateEmails: () => void;
  emailCount: () => number;

  // IMAP accounts (sensitive data stays in secure storage)
  imapAccounts: ImapAccount[];
  addImapAccount: (account: ImapAccount) => void;
  removeImapAccount: (id: string) => void;
  toggleImapAccount: (id: string) => void;
  updateImapStatus: (id: string, status: ImapAccount['status']) => void;
  testImapConnection: (account: ImapAccount) => Promise<boolean>;

  // Catch-All Config
  catchAllConfig: CatchAllConfig;
  setCatchAllConfig: (config: Partial<CatchAllConfig>) => void;

  // Browser config
  browserConfig: BrowserConfig;
  setBrowserConfig: (config: Partial<BrowserConfig>) => void;

  // Proxy config
  proxyConfig: ProxyConfig;
  setProxyConfig: (config: Partial<ProxyConfig>) => void;

  // Registration settings
  interval: number;
  setInterval: (interval: number) => void;
  savePath: string;
  setSavePath: (path: string) => void;
  deleteMailAfterRead: boolean;
  setDeleteMailAfterRead: (val: boolean) => void;
  fetchTokenAfterRegister: boolean;
  setFetchTokenAfterRegister: (val: boolean) => void;

  // Running state
  isRunning: boolean;
  progress: ProgressState;
  startRegistration: () => Promise<void>;
  autoRegister: (count?: number) => Promise<void>;
  stopRegistration: () => void;

  // Logs
  logs: string[];
  addLog: (log: string) => void;
  clearLogs: () => void;
}

export const useRegistrationStore = create<RegistrationStore>((set, get) => ({
  // ── Mode ──
  mode: 'imap',
  setMode: (mode) => set({ mode }),

  // ── Emails ──
  emails: '',
  setEmails: (emails) => set({ emails }),
  deduplicateEmails: () => {
    const { emails } = get();
    const lines = emails.split('\n');
    const seen = new Set<string>();
    const deduped = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || seen.has(trimmed)) return false;
      seen.add(trimmed);
      return true;
    });
    set({ emails: deduped.join('\n') });
  },
  emailCount: () => {
    const { emails } = get();
    return emails
      .split('\n')
      .filter((e) => e.trim() && e.includes('@')).length;
  },

  // ── IMAP ──
  imapAccounts: [],
  addImapAccount: (account) =>
    set((s) => ({ imapAccounts: [...s.imapAccounts, account] })),
  removeImapAccount: (id) =>
    set((s) => ({ imapAccounts: s.imapAccounts.filter((a) => a.id !== id) })),
  toggleImapAccount: (id) =>
    set((s) => ({
      imapAccounts: s.imapAccounts.map((a) =>
        a.id === id ? { ...a, enabled: !a.enabled } : a
      ),
    })),
  updateImapStatus: (id, status) =>
    set((s) => ({
      imapAccounts: s.imapAccounts.map((a) =>
        a.id === id ? { ...a, status } : a
      ),
    })),
  testImapConnection: async (account) => {
    const { updateImapStatus } = get();
    updateImapStatus(account.id, 'testing');
    try {
      const result = (await window.electronAPI.invoke(Channels.IMAP_TEST, {
        email: account.email,
        password: account.password,
        host: account.host,
        port: account.port,
      })) as { success: boolean };
      updateImapStatus(account.id, result.success ? 'success' : 'fail');
      return result.success;
    } catch {
      updateImapStatus(account.id, 'fail');
      return false;
    }
  },

  // ── Catch-All ──
  catchAllConfig: {
    enabled: false,
    domain: '',
    imapHost: '',
    imapPort: 993,
    imapUser: '',
    imapPass: '',
    imapTls: true,
    targetCount: 10,
  },
  setCatchAllConfig: (config) =>
    set((s) => ({ catchAllConfig: { ...s.catchAllConfig, ...config } })),

  // ── Browser ──
  browserConfig: {
    type: 'vb',
    cdpPort: 9222,
    vbDynamicEnv: true,
    vbApiKey: '',
    vbBaseURL: 'http://localhost:9000',
    vbChromeVersion: 132,
    vbGroupId: '',
    vbExecutablePath: 'C:\\Program Files\\VirtualBrowser\\VirtualBrowser.exe',
    nstApiKey: '',
    nstProfileId: '',
    nstUseOnceBrowser: false,
  },
  setBrowserConfig: (config) =>
    set((s) => ({ browserConfig: { ...s.browserConfig, ...config } })),

  // ── Proxy ──
  proxyConfig: {
    enabled: false,
    strategy: 'adb',
    adbPath: 'C:\\adb\\platform-tools\\adb.exe',
    airplaneDuration: 5,
    networkRecoverWait: 5,
    clashApiUrl: 'http://127.0.0.1:9097',
    clashApiSecret: '',
    clashProxyGroup: '',
    clashExcludeNodes: '',
    zteHost: '192.168.0.1',
    ztePassword: 'admin',
    switchEveryN: 1,
    switchOnCloudflareN: 4,
    switchOnFailN: 4,
  },
  setProxyConfig: (config) =>
    set((s) => ({ proxyConfig: { ...s.proxyConfig, ...config } })),

  // ── Settings ──
  interval: 10,
  setInterval: (interval) => set({ interval }),
  savePath: '',
  setSavePath: (savePath) => set({ savePath }),
  deleteMailAfterRead: false,
  setDeleteMailAfterRead: (deleteMailAfterRead) => set({ deleteMailAfterRead }),
  fetchTokenAfterRegister: true,
  setFetchTokenAfterRegister: (fetchTokenAfterRegister) =>
    set({ fetchTokenAfterRegister }),

  // ── Running ──
  isRunning: false,
  progress: {
    current: 0,
    total: 0,
    success: 0,
    fail: 0,
    currentEmail: '',
    currentStep: '',
    stepProgress: 0,
    estimatedTimeRemaining: 0,
    errors: [],
  },

  startRegistration: async () => {
    const state = get();
    if (state.isRunning) return;

    let emailList: string[] = [];

    if (state.catchAllConfig.enabled) {
      if (!state.catchAllConfig.domain) {
        state.addLog('❌ 请配置 Catch-All 域名 (例如 xyz.com)');
        return;
      }
      if (!state.catchAllConfig.imapHost || !state.catchAllConfig.imapUser) {
        state.addLog('❌ 请配置 Catch-All 统一收件箱 IMAP 信息');
        return;
      }
      const count = state.catchAllConfig.targetCount || 10;
      emailList = Array.from({ length: count }, () => {
        const randomStr = Math.random().toString(36).substring(2, 10);
        return `${randomStr}@${state.catchAllConfig.domain}`;
      });
    } else {
      emailList = state.emails
        .split('\n')
        .map((e) => e.trim())
        .filter((e) => e && e.includes('@'));

      if (emailList.length === 0) {
        state.addLog('❌ 请输入待注册邮箱列表');
        return;
      }

      const enabledImap = state.imapAccounts.filter((a) => a.enabled);
      if (enabledImap.length === 0) {
        state.addLog('❌ 请启用至少一个 IMAP 接收邮箱');
        return;
      }
    }

    set({
      isRunning: true,
      progress: {
        current: 0,
        total: emailList.length,
        success: 0,
        fail: 0,
        currentEmail: '',
        currentStep: '准备中...',
        stepProgress: 0,
        estimatedTimeRemaining: 0,
        errors: [],
      },
    });

    state.addLog(`🚀 开始批量注册 — 共 ${emailList.length} 个账号`);

    try {
      await window.electronAPI.invoke(Channels.REGISTER_START, {
        emails: emailList,
        imapAccounts: state.catchAllConfig.enabled 
          ? [{
              id: 'catch-all',
              email: state.catchAllConfig.imapUser,
              password: state.catchAllConfig.imapPass,
              host: state.catchAllConfig.imapHost,
              port: state.catchAllConfig.imapPort,
              tls: state.catchAllConfig.imapTls,
              enabled: true
            }]
          : state.imapAccounts.filter((a) => a.enabled),
        catchAllConfig: state.catchAllConfig.enabled ? state.catchAllConfig : undefined,
        browserConfig: state.browserConfig,
        ipConfig: state.proxyConfig.enabled
          ? { ...state.proxyConfig }
          : undefined,
        captchaConfig: {
          type: 'yescaptcha', 
          apiKey: '' // Configured via UI later
        },
        savePath: state.savePath,
        interval: state.interval,
        deleteMailAfterRead: state.deleteMailAfterRead,
        fetchTokenAfterRegister: state.fetchTokenAfterRegister,
        timeout: 120000,
      });
    } catch (error) {
      state.addLog(`❌ 注册失败: ${error}`);
    } finally {
      set({ isRunning: false });
    }
  },

  autoRegister: async (count: number = 5) => {
    set({
      isRunning: true,
      progress: {
        total: count,
        current: 0,
        success: 0,
        fail: 0,
        currentStep: 'Initializing Auto-Registration',
        estimatedTimeRemaining: 0,
        currentEmail: '',
        stepProgress: 0,
        errors: [],
      },
    });
    get().clearLogs();
    get().addLog('🚀 启动一键自动注册...');

    try {
      const response = await window.electronAPI.invoke(Channels.REGISTER_AUTO, {
        count,
        platform: 'cursor', // default to cursor for now
      }) as any;

      if (response && response.success) {
        get().addLog(`✅ 自动注册完成: ${response.results.length} 个账号`);
      } else {
        get().addLog(`❌ 自动注册失败: ${response?.error}`);
      }
    } catch (e: any) {
      get().addLog(`❌ 自动注册出错: ${e.message}`);
    } finally {
      set({ isRunning: false });
    }
  },

  stopRegistration: () => {
    window.electronAPI.send(Channels.REGISTER_STOP);
    get().addLog('⛔ 正在停止...');
  },

  // ── Logs ──
  logs: [],
  addLog: (log) =>
    set((s) => ({
      logs: [...s.logs.slice(-499), `[${new Date().toLocaleTimeString()}] ${log}`],
    })),
  clearLogs: () => set({ logs: [] }),
}));
