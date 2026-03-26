import { useState } from 'react';
import { useRegistrationStore } from '../stores/registrationStore';
import { Channels } from '../../electron/ipc/channels';

// ─── IMAP Server Auto-Detection ───
const IMAP_SERVERS: Record<string, { host: string; port: number; name: string }> = {
  'gmail.com': { host: 'imap.gmail.com', port: 993, name: 'Gmail' },
  'outlook.com': { host: 'imap-mail.outlook.com', port: 993, name: 'Outlook' },
  'hotmail.com': { host: 'imap-mail.outlook.com', port: 993, name: 'Hotmail' },
  'qq.com': { host: 'imap.qq.com', port: 993, name: 'QQ邮箱' },
  '163.com': { host: 'imap.163.com', port: 993, name: '163' },
  '126.com': { host: 'imap.126.com', port: 993, name: '126' },
  'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993, name: 'Yahoo' },
  'icloud.com': { host: 'imap.mail.me.com', port: 993, name: 'iCloud' },
  'me.com': { host: 'imap.mail.me.com', port: 993, name: 'iCloud' },
};

export function RegistrationPage() {
  const store = useRegistrationStore();
  const progressPercent =
    store.progress.total > 0
      ? (store.progress.current / store.progress.total) * 100
      : 0;

  // ─── IMAP Form State ───
  const [imapEmail, setImapEmail] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [autoDetect, setAutoDetect] = useState(true);
  const [imapTesting, setImapTesting] = useState(false);

  // ─── Collapsed Sections ───
  const [sections, setSections] = useState({
    emails: true,
    imap: true,
    settings: true,
    proxy: false,
  });
  const toggleSection = (key: keyof typeof sections) => {
    setSections((s) => ({ ...s, [key]: !s[key] }));
  };

  // ─── Add IMAP Account ───
  const handleAddImap = async () => {
    if (!imapEmail || !imapPassword) return;
    const domain = imapEmail.split('@')[1]?.toLowerCase();
    const server = autoDetect && domain ? IMAP_SERVERS[domain] : null;
    const host = server?.host || imapHost;
    const port = server?.port || imapPort;
    if (!host) {
      store.addLog('❌ 无法自动检测 IMAP 服务器，请手动输入');
      return;
    }

    const account = {
      id: Date.now().toString(),
      email: imapEmail,
      password: imapPassword,
      host,
      port,
      tls: true,
      enabled: true,
    };

    setImapTesting(true);
    const success = await store.testImapConnection(account);
    setImapTesting(false);

    if (success) {
      store.addImapAccount({ ...account, status: 'success' });
      setImapEmail('');
      setImapPassword('');
      store.addLog(`✅ IMAP 添加成功: ${imapEmail}`);
    } else {
      store.addLog(`❌ IMAP 连接失败: ${imapEmail}`);
    }
  };

  // ─── Select Save Path ───
  const handleSelectPath = async () => {
    const path = await window.electronAPI.invoke(Channels.DIALOG_SELECT_DIR);
    if (path) store.setSavePath(path as string);
  };

  return (
    <div className="animate-in">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Cursor 批量注册</h1>
          <p className="page-subtitle">使用 IMAP 邮箱自动化注册 Cursor 账号</p>
        </div>
        <div className="stats-bar">
          <span className="stat-label">统计</span>
          <span className="stat-success">成功 {store.progress.success}</span>
          <span className="divider" />
          <span className="stat-fail">失败 {store.progress.fail}</span>
          <span className="divider" />
          <span className="stat-total">总计 {store.progress.total}</span>
        </div>
      </div>

      {/* ── Progress Bar (when running) ── */}
      {store.isRunning && (
        <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8, color: 'var(--text-secondary)' }}>
            <span>
              {store.progress.currentStep} ({store.progress.current}/{store.progress.total})
            </span>
            <span>{progressPercent.toFixed(0)}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          {store.progress.currentEmail && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
              📧 {store.progress.currentEmail}
              {store.progress.estimatedTimeRemaining > 0 && (
                <span style={{ marginLeft: 12 }}>
                  ⏱ 预计剩余 {Math.round(store.progress.estimatedTimeRemaining / 1000)}s
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Two Column Layout ── */}
      <div className="two-column">
        {/* Left: Config Panels */}
        <div className="column-left">
          {/* ── Catch-All 模式切换 ── */}
          <div className="card">
            <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => store.setCatchAllConfig({ enabled: !store.catchAllConfig.enabled })}>
              <span className="card-title">🌐 Catch-All 无限邮箱模式</span>
              <button
                className={`toggle ${store.catchAllConfig.enabled ? 'active' : 'inactive'}`}
                onClick={(e) => { e.stopPropagation(); store.setCatchAllConfig({ enabled: !store.catchAllConfig.enabled }); }}
              >
                <span className="toggle-dot" />
              </button>
            </div>
            {store.catchAllConfig.enabled && (
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="alert" style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 8, padding: '8px 12px', fontSize: 11, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                  💡 绑定一个廉价域名（$1/年），所有 <code>随机前缀@你的域名</code> 的邮件将统一转发到下方配置的 IMAP 邮箱。
                </div>
                <div className="form-group">
                  <label className="label">Catch-All 域名</label>
                  <input
                    className="input"
                    type="text"
                    value={store.catchAllConfig.domain}
                    onChange={(e) => store.setCatchAllConfig({ domain: e.target.value })}
                    placeholder="例如: nirvana-reg.icu"
                    disabled={store.isRunning}
                  />
                </div>
                <div className="form-group">
                  <label className="label">批量注册数量</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={200}
                    value={store.catchAllConfig.targetCount}
                    onChange={(e) => store.setCatchAllConfig({ targetCount: parseInt(e.target.value) || 10 })}
                    disabled={store.isRunning}
                  />
                </div>
                <div style={{ border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                    📬 统一收件箱 (IMAP)
                  </div>
                  <input
                    className="input"
                    type="text"
                    value={store.catchAllConfig.imapHost}
                    onChange={(e) => store.setCatchAllConfig({ imapHost: e.target.value })}
                    placeholder="IMAP 主机 (如 imap-mail.outlook.com)"
                    disabled={store.isRunning}
                    style={{ marginBottom: 6 }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input
                      className="input"
                      type="text"
                      value={store.catchAllConfig.imapUser}
                      onChange={(e) => store.setCatchAllConfig({ imapUser: e.target.value })}
                      placeholder="IMAP 用户 (你的真实邮箱)"
                      disabled={store.isRunning}
                      style={{ flex: 1 }}
                    />
                    <input
                      className="input"
                      type="number"
                      value={store.catchAllConfig.imapPort}
                      onChange={(e) => store.setCatchAllConfig({ imapPort: parseInt(e.target.value) || 993 })}
                      disabled={store.isRunning}
                      style={{ width: 70 }}
                    />
                  </div>
                  <input
                    className="input"
                    type="password"
                    value={store.catchAllConfig.imapPass}
                    onChange={(e) => store.setCatchAllConfig({ imapPass: e.target.value })}
                    placeholder="IMAP 密码/应用专用密码"
                    disabled={store.isRunning}
                  />
                </div>
                {store.catchAllConfig.domain && (
                  <div style={{ fontSize: 11, color: 'var(--accent)', padding: '6px 10px', background: 'rgba(168, 85, 247, 0.08)', borderRadius: 6 }}>
                    🎯 将生成 {store.catchAllConfig.targetCount} 个 <code style={{ fontFamily: 'monospace' }}>xxxxxxxx@{store.catchAllConfig.domain}</code> 随机邮箱
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Email list (hidden when Catch-All enabled) */}
          {!store.catchAllConfig.enabled && (
          <div className="card">
            <div className="card-header" onClick={() => toggleSection('emails')}>
              <span className="card-title">📋 待注册邮箱列表</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, transition: 'transform 0.2s', transform: sections.emails ? 'rotate(180deg)' : '' }}>▼</span>
            </div>
            {sections.emails && (
              <div className="card-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label className="label">邮箱列表</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={store.deduplicateEmails}
                      disabled={store.isRunning}
                    >
                      🔄 去重
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={async () => {
                        const path = await window.electronAPI.invoke(Channels.DIALOG_SELECT_FILE, {
                          filters: [{ name: '邮箱列表', extensions: ['txt'] }],
                        });
                        if (path) {
                          const content = await window.electronAPI.invoke(Channels.FS_READ_FILE, path);
                          if (content) store.setEmails(content as string);
                        }
                      }}
                      disabled={store.isRunning}
                    >
                      📂 导入
                    </button>
                  </div>
                </div>
                <textarea
                  className="input"
                  value={store.emails}
                  onChange={(e) => store.setEmails(e.target.value)}
                  disabled={store.isRunning}
                  placeholder={"每行一个邮箱地址\n例如：\nemail1@icloud.com\nemail2@163.com"}
                  rows={5}
                />
                <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                  已输入 {store.emailCount()} 个邮箱
                </div>
              </div>
            )}
          </div>
          )}

          {/* IMAP Accounts (hidden when Catch-All enabled) */}
          {!store.catchAllConfig.enabled && (
          <div className="card">
            <div className="card-header" onClick={() => toggleSection('imap')}>
              <span className="card-title">📧 IMAP 接收邮箱 <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(用于接收验证码)</span></span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, transition: 'transform 0.2s', transform: sections.imap ? 'rotate(180deg)' : '' }}>▼</span>
            </div>
            {sections.imap && (
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Existing accounts */}
                {store.imapAccounts.map((acc) => (
                  <div key={acc.id} className="imap-item" style={{ opacity: acc.enabled ? 1 : 0.5 }}>
                    <button
                      className={`toggle ${acc.enabled ? 'active' : 'inactive'}`}
                      onClick={() => store.toggleImapAccount(acc.id)}
                      disabled={store.isRunning}
                    >
                      <span className="toggle-dot" />
                    </button>
                    <span className={`status-dot ${acc.status || 'unknown'}`} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="imap-email">{acc.email}</div>
                      <div className="imap-server">{acc.host}:{acc.port}</div>
                    </div>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => store.testImapConnection(acc)}
                      disabled={store.isRunning || acc.status === 'testing'}
                      style={{ padding: '4px 8px' }}
                    >
                      🔗
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => store.removeImapAccount(acc.id)}
                      disabled={store.isRunning}
                      style={{ padding: '4px 8px', color: 'var(--danger)' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {/* Add new IMAP */}
                <div style={{ border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                    ➕ 添加接收邮箱
                  </div>
                  <input
                    className="input"
                    type="email"
                    value={imapEmail}
                    onChange={(e) => {
                      setImapEmail(e.target.value);
                      if (autoDetect) {
                        const domain = e.target.value.split('@')[1]?.toLowerCase();
                        if (domain && IMAP_SERVERS[domain]) {
                          setImapHost(IMAP_SERVERS[domain].host);
                          setImapPort(IMAP_SERVERS[domain].port);
                        }
                      }
                    }}
                    placeholder="接收邮箱地址"
                    disabled={store.isRunning || imapTesting}
                    style={{ marginBottom: 6 }}
                  />
                  <input
                    className="input"
                    type="password"
                    value={imapPassword}
                    onChange={(e) => setImapPassword(e.target.value)}
                    placeholder="应用专用密码/授权码"
                    disabled={store.isRunning || imapTesting}
                    style={{ marginBottom: 8 }}
                  />
                  <button
                    className="btn btn-primary btn-full btn-sm"
                    onClick={handleAddImap}
                    disabled={store.isRunning || imapTesting || !imapEmail || !imapPassword}
                  >
                    {imapTesting ? 'IMAP 连接中...' : '添加 IMAP 邮箱'}
                  </button>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Settings */}
          <div className="card">
            <div className="card-header" onClick={() => toggleSection('settings')}>
              <span className="card-title">⚙️ 基础设置</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, transition: 'transform 0.2s', transform: sections.settings ? 'rotate(180deg)' : '' }}>▼</span>
            </div>
            {sections.settings && (
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label className="label">注册间隔 (秒)</label>
                  <input
                    className="input"
                    type="number"
                    min={5}
                    max={120}
                    value={store.interval}
                    onChange={(e) => store.setInterval(parseInt(e.target.value) || 10)}
                    disabled={store.isRunning}
                  />
                </div>
                <div className="form-group">
                  <label className="label">保存路径</label>
                  <div className="form-row">
                    <input
                      className="input"
                      type="text"
                      value={store.savePath}
                      onChange={(e) => store.setSavePath(e.target.value)}
                      disabled={store.isRunning}
                      style={{ flex: 1 }}
                    />
                    <button className="btn btn-outline btn-sm" onClick={handleSelectPath} disabled={store.isRunning}>
                      浏览
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label className="label">指纹浏览器</label>
                  <div className="form-row">
                    <button
                      className={`btn btn-sm ${store.browserConfig.type === 'vb' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => store.setBrowserConfig({ type: 'vb' })}
                      style={{ flex: 1 }}
                      disabled={store.isRunning}
                    >
                      🖥️ VirtualBrowser
                    </button>
                    <button
                      className={`btn btn-sm ${store.browserConfig.type === 'nstbrowser' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => store.setBrowserConfig({ type: 'nstbrowser' })}
                      style={{ flex: 1 }}
                      disabled={store.isRunning}
                    >
                      🌍 Nstbrowser
                    </button>
                  </div>
                </div>
                {/* Toggle options */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    className={`toggle ${store.deleteMailAfterRead ? 'active' : 'inactive'}`}
                    onClick={() => store.setDeleteMailAfterRead(!store.deleteMailAfterRead)}
                  >
                    <span className="toggle-dot" />
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>读取验证码后删除邮件</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    className={`toggle ${store.fetchTokenAfterRegister ? 'active' : 'inactive'}`}
                    onClick={() => store.setFetchTokenAfterRegister(!store.fetchTokenAfterRegister)}
                  >
                    <span className="toggle-dot" />
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>注册后获取 Token</span>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {store.isRunning ? (
              <button className="btn btn-danger btn-full" onClick={store.stopRegistration}>
                ■ 停止注册
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline" style={{ flex: 1, backgroundColor: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)', color: '#60a5fa' }} onClick={() => store.autoRegister(10)}>
                  ⚡ 一键全自动 (10个)
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={store.startRegistration}>
                  ▶ 常规注册
                </button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="alert warning">
            <strong>⚠️ 注意事项</strong>
            <ul style={{ paddingLeft: 16, marginTop: 4, lineHeight: 1.8 }}>
              <li>Cursor 注册可能需要手动完成人机验证</li>
              <li>需要使用应用专用密码，非登录密码</li>
              <li>注册间隔建议不少于 10 秒</li>
            </ul>
          </div>
        </div>

        {/* Right: Log Viewer */}
        <div className="column-right">
          <div className="log-viewer" style={{ height: 'calc(100vh - 160px)' }}>
            <div className="log-viewer-header">
              <span>📋 运行日志</span>
              <button className="btn btn-outline btn-sm" onClick={store.clearLogs}>
                清空
              </button>
            </div>
            <div className="log-viewer-body" style={{ height: 'calc(100% - 44px)' }}>
              {store.logs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  暂无日志，点击"开始注册"后这里会显示运行日志...
                </div>
              ) : (
                store.logs.map((log, i) => (
                  <div
                    key={i}
                    className={`log-line ${
                      log.includes('✅') ? 'success' : log.includes('❌') ? 'error' : log.includes('⚠️') ? 'warn' : ''
                    }`}
                  >
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
