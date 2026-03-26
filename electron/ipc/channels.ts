/**
 * IPC Channels — Single source of truth for all IPC communication
 * Both main and renderer processes import from here.
 */
export const Channels = {
  // ─── Control Center (Dashboard) ───
  ENGINE_FOUNDRY_START: 'engine:foundry:start',
  ENGINE_FOUNDRY_STOP: 'engine:foundry:stop',
  ENGINE_FOUNDRY_STATUS: 'engine:foundry:status',

  ENGINE_GHOSTFLEET_START: 'engine:ghostfleet:start',
  ENGINE_GHOSTFLEET_STOP: 'engine:ghostfleet:stop',
  ENGINE_GHOSTFLEET_STATUS: 'engine:ghostfleet:status',

  ENGINE_GATLING_START: 'engine:gatling:start',
  ENGINE_GATLING_STOP: 'engine:gatling:stop',
  ENGINE_GATLING_PROGRESS: 'engine:gatling:progress',

  ENGINE_GLOBAL_LOG: 'engine:global:log',

  // ─── Registration Engine (Generic + Cursor) ───
  REGISTER_START: 'register:start',
  REGISTER_AUTO: 'register:auto',
  REGISTER_STOP: 'register:stop',
  REGISTER_PROGRESS: 'register:progress',
  REGISTER_LOG: 'register:log',

  // ─── Kiro Registration ───
  KIRO_REGISTER_START: 'kiro:register:start',
  KIRO_REGISTER_STOP: 'kiro:register:stop',
  KIRO_REGISTER_PROGRESS: 'kiro:register:progress',
  KIRO_IMAP_TEST: 'kiro:imap:test',
  KIRO_BINDCARD_START: 'kiro:bindcard:start',
  KIRO_BINDCARD_STOP: 'kiro:bindcard:stop',
  KIRO_BINDCARD_PROGRESS: 'kiro:bindcard:progress',
  KIRO_BINDCARD_REQUEST_CARD: 'kiro:bindcard:request-card',
  KIRO_BINDCARD_SUBMIT_CARD: 'kiro:bindcard:submit-card',

  // ─── Windsurf Registration ───
  WINDSURF_REGISTER_START: 'windsurf:register:start',
  WINDSURF_REGISTER_STOP: 'windsurf:register:stop',
  WINDSURF_REGISTER_PROGRESS: 'windsurf:register:progress',
  WINDSURF_IMAP_TEST: 'windsurf:imap:test',
  WINDSURF_GET_LOCAL_ACCOUNT: 'windsurf:get-local-account',
  WINDSURF_DETECT_INSTALL_PATH: 'windsurf:detect-install-path',

  // ─── Token Extraction ───
  TOKEN_BATCH_START: 'token:batch-start',
  TOKEN_BATCH_STOP: 'token:batch-stop',
  TOKEN_PROGRESS: 'token:progress',

  // ─── Card Binding ───
  BINDCARD_START: 'bindcard:start',
  BINDCARD_STOP: 'bindcard:stop',
  BINDCARD_PROGRESS: 'bindcard:progress',
  BINDCARD_REQUEST_INFO: 'bindcard:request-info',
  BINDCARD_SUBMIT_INFO: 'bindcard:submit-info',

  // ─── IMAP ───
  IMAP_TEST: 'imap:test-connection',
  IMAP_LIST: 'imap:list-accounts',
  IMAP_ADD: 'imap:add-account',
  IMAP_REMOVE: 'imap:remove-account',
  IMAP_TOGGLE: 'imap:toggle-account',

  // ─── Browser Management ───
  BROWSER_HEALTH: 'browser:health-check',
  BROWSER_LIST_ENVS: 'browser:list-envs',

  // ─── IP Switching ───
  IP_SWITCH: 'ip:switch',
  IP_GET_CURRENT: 'ip:get-current',
  IP_HEALTH: 'ip:health-check',

  // ─── Secure Storage ───
  STORAGE_GET: 'storage:get',
  STORAGE_SET: 'storage:set',
  STORAGE_DELETE: 'storage:delete',

  // ─── Outlook Toolbox ───
  OUTLOOK_REGISTER_START: 'outlook:register:start',
  OUTLOOK_REGISTER_STOP: 'outlook:register:stop',
  OUTLOOK_REGISTER_PROGRESS: 'outlook:register:progress',
  OUTLOOK_FORWARD_SETUP: 'outlook:forward:setup',
  OUTLOOK_VERIFY_START: 'outlook:verify:start',
  OUTLOOK_VERIFY_PROGRESS: 'outlook:verify:progress',
  OUTLOOK_LOG: 'outlook:log',

  // ─── Account Pool ───
  POOL_LIST: 'pool:list',
  POOL_ADD: 'pool:add',
  POOL_REMOVE: 'pool:remove',
  POOL_UPDATE: 'pool:update',
  POOL_IMPORT: 'pool:import',
  POOL_EXPORT: 'pool:export',
  POOL_PULL: 'pool:pull',
  POOL_SYNC_REGPLATFORM: 'pool:sync-regplatform',
  POOL_STATS: 'pool:stats',

  // ─── Proxy Pool ───
  PROXY_LIST: 'proxy:list',
  PROXY_ADD: 'proxy:add',
  PROXY_REMOVE: 'proxy:remove',
  PROXY_IMPORT: 'proxy:import',
  PROXY_IMPORT_FILE: 'proxy:import-file',
  PROXY_EXPORT: 'proxy:export',
  PROXY_HEALTH_CHECK: 'proxy:health-check',
  PROXY_GET_NEXT: 'proxy:get-next',
  PROXY_STATS: 'proxy:stats',
  PROXY_APPLY: 'proxy:apply',
  PROXY_FETCH_SOURCES: 'proxy:fetch-sources',
  PROXY_LIST_SOURCES: 'proxy:list-sources',
  PROXY_TUNNEL_INFO: 'proxy:tunnel-info',
  PROXY_REFRESH_FASTLANE: 'proxy:refresh-fastlane',

  // ─── Switch Account ───
  SWITCH_ACCOUNT: 'switch:account',
  SWITCH_RESET_MACHINE_ID: 'switch:reset-machine-id',
  SWITCH_CLEAN_CACHE: 'switch:clean-cache',
  SWITCH_DETECT_INSTALL: 'switch:detect-install',

  // ─── Admin API ───
  ADMIN_LOGIN: 'admin:login',
  ADMIN_LOGOUT: 'admin:logout',
  ADMIN_GET_USER_STATS: 'admin:get-user-stats',
  ADMIN_GET_REVENUE: 'admin:get-revenue',
  ADMIN_GET_POOL_STATS: 'admin:get-pool-stats',

  // ─── App Lifecycle ───
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_MAXIMIZE_CHANGE: 'window:maximize-change',
  APP_GET_VERSION: 'app:get-version',
  APP_GET_PLATFORM: 'app:get-platform',

  // ─── File System ───
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  DIALOG_SELECT_FILE: 'dialog:select-file',
  DIALOG_SELECT_DIR: 'dialog:select-directory',
} as const;

export type Channel = (typeof Channels)[keyof typeof Channels];
