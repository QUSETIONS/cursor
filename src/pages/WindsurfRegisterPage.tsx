import { useState } from 'react';
import { useRegistrationStore } from '../stores/registrationStore';
import { Channels } from '../../electron/ipc/channels';

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

export function WindsurfRegisterPage() {
  const store = useRegistrationStore();
  const progressPercent = store.progress.total > 0 ? (store.progress.current / store.progress.total) * 100 : 0;

  const [imapEmail, setImapEmail] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [imapTesting, setImapTesting] = useState(false);
  const [sections, setSections] = useState({ emails: true, imap: true, settings: true });
  const toggleSection = (k: keyof typeof sections) => setSections(s => ({ ...s, [k]: !s[k] }));

  const handleAddImap = async () => {
    if (!imapEmail || !imapPassword) return;
    const domain = imapEmail.split('@')[1]?.toLowerCase();
    const server = domain ? IMAP_SERVERS[domain] : null;
    if (!server) { store.addLog('❌ 未知邮箱域名'); return; }

    const account = { id: Date.now().toString(), email: imapEmail, password: imapPassword, host: server.host, port: server.port, tls: true, enabled: true };
    setImapTesting(true);
    const ok = await store.testImapConnection(account);
    setImapTesting(false);
    if (ok) {
      store.addImapAccount({ ...account, status: 'success' });
      setImapEmail(''); setImapPassword('');
      store.addLog(`✅ IMAP 添加成功: ${imapEmail}`);
    } else {
      store.addLog(`❌ IMAP 连接失败: ${imapEmail}`);
    }
  };

  return (
    <div className="animate-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ background: 'linear-gradient(135deg, #0ea5e9, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Windsurf 批量注册
          </h1>
          <p className="page-subtitle">使用 IMAP 邮箱自动化注册 Windsurf (Codeium) 账号</p>
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

      {/* Progress */}
      {store.isRunning && (
        <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8, color: 'var(--text-secondary)' }}>
            <span>{store.progress.currentStep} ({store.progress.current}/{store.progress.total})</span>
            <span>{progressPercent.toFixed(0)}%</span>
          </div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${progressPercent}%`, background: 'linear-gradient(90deg, #0ea5e9, #3b82f6)' }} /></div>
        </div>
      )}

      {/* Two-column */}
      <div className="two-column">
        <div className="column-left">
          {/* Email list */}
          <div className="card">
            <div className="card-header" onClick={() => toggleSection('emails')}>
              <span className="card-title">📋 待注册邮箱列表</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, transition: 'transform 0.2s', transform: sections.emails ? 'rotate(180deg)' : '' }}>▼</span>
            </div>
            {sections.emails && (
              <div className="card-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label className="label">邮箱列表</label>
                  <button className="btn btn-outline btn-sm" onClick={store.deduplicateEmails} disabled={store.isRunning}>🔄 去重</button>
                </div>
                <textarea className="input" value={store.emails} onChange={(e) => store.setEmails(e.target.value)} disabled={store.isRunning} placeholder={"每行一个邮箱\n例如：\nuser1@gmail.com"} rows={5} />
                <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>已输入 {store.emailCount()} 个邮箱</div>
              </div>
            )}
          </div>

          {/* IMAP */}
          <div className="card">
            <div className="card-header" onClick={() => toggleSection('imap')}>
              <span className="card-title">📧 IMAP 接收邮箱</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, transition: 'transform 0.2s', transform: sections.imap ? 'rotate(180deg)' : '' }}>▼</span>
            </div>
            {sections.imap && (
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {store.imapAccounts.map(acc => (
                  <div key={acc.id} className="imap-item" style={{ opacity: acc.enabled ? 1 : 0.5 }}>
                    <button className={`toggle ${acc.enabled ? 'active' : 'inactive'}`} onClick={() => store.toggleImapAccount(acc.id)}><span className="toggle-dot" /></button>
                    <span className={`status-dot ${acc.status || 'unknown'}`} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="imap-email">{acc.email}</div>
                      <div className="imap-server">{acc.host}:{acc.port}</div>
                    </div>
                    <button className="btn btn-outline btn-sm" onClick={() => store.removeImapAccount(acc.id)} style={{ padding: '4px 8px', color: 'var(--danger)' }}>✕</button>
                  </div>
                ))}
                <div style={{ border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>➕ 添加接收邮箱</div>
                  <input className="input" type="email" value={imapEmail} onChange={e => setImapEmail(e.target.value)} placeholder="接收邮箱地址" style={{ marginBottom: 6 }} />
                  <input className="input" type="password" value={imapPassword} onChange={e => setImapPassword(e.target.value)} placeholder="应用专用密码/授权码" style={{ marginBottom: 8 }} />
                  <button className="btn btn-full btn-sm" style={{ background: 'linear-gradient(135deg, #0ea5e9, #3b82f6)', color: 'white' }} onClick={handleAddImap} disabled={store.isRunning || imapTesting || !imapEmail || !imapPassword}>
                    {imapTesting ? '连接中...' : '添加 IMAP 邮箱'}
                  </button>
                </div>
              </div>
            )}
          </div>

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
                  <input className="input" type="number" min={5} max={120} value={store.interval} onChange={e => store.setInterval(parseInt(e.target.value) || 10)} disabled={store.isRunning} />
                </div>
                <div className="form-group">
                  <label className="label">浏览器</label>
                  <div className="form-row">
                    <button className={`btn btn-sm ${store.browserConfig.type === 'vb' ? 'btn-primary' : 'btn-outline'}`} onClick={() => store.setBrowserConfig({ type: 'vb' })} style={{ flex: 1 }}>VirtualBrowser</button>
                    <button className={`btn btn-sm ${store.browserConfig.type === 'nstbrowser' ? 'btn-primary' : 'btn-outline'}`} onClick={() => store.setBrowserConfig({ type: 'nstbrowser' })} style={{ flex: 1 }}>Nstbrowser</button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className={`toggle ${store.fetchTokenAfterRegister ? 'active' : 'inactive'}`} onClick={() => store.setFetchTokenAfterRegister(!store.fetchTokenAfterRegister)}><span className="toggle-dot" /></button>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>注册后获取 API Key</span>
                </div>
              </div>
            )}
          </div>

          {/* Action */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {store.isRunning ? (
              <button className="btn btn-danger btn-full" onClick={store.stopRegistration}>■ 停止注册</button>
            ) : (
              <button className="btn btn-full" style={{ background: 'linear-gradient(135deg, #0ea5e9, #3b82f6)', color: 'white', boxShadow: '0 4px 16px rgba(14,165,233,0.3)' }} onClick={store.startRegistration}>
                ▶ 开始注册
              </button>
            )}
          </div>

          <div className="alert info" style={{ background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.2)', color: '#7dd3fc' }}>
            <strong>💡 Windsurf 注册说明</strong>
            <ul style={{ paddingLeft: 16, marginTop: 4, lineHeight: 1.8 }}>
              <li>Windsurf 使用 Codeium 账号体系</li>
              <li>注册时需要填写邮箱 + 密码 + 姓名</li>
              <li>可能遇到 Turnstile/reCAPTCHA 验证</li>
              <li>API Key 可用于本地 IDE 激活</li>
            </ul>
          </div>
        </div>

        {/* Log viewer */}
        <div className="column-right">
          <div className="log-viewer" style={{ height: 'calc(100vh - 160px)' }}>
            <div className="log-viewer-header">
              <span>📋 运行日志</span>
              <button className="btn btn-outline btn-sm" onClick={store.clearLogs}>清空</button>
            </div>
            <div className="log-viewer-body" style={{ height: 'calc(100% - 44px)' }}>
              {store.logs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>暂无日志...</div>
              ) : (
                store.logs.map((log, i) => (
                  <div key={i} className={`log-line ${log.includes('✅') ? 'success' : log.includes('❌') ? 'error' : log.includes('⚠️') ? 'warn' : ''}`}>{log}</div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
