import { useState, useEffect } from 'react';

export function SettingsPage() {
  const [proxyType, setProxyType] = useState<'none' | 'http' | 'socks5'>('none');
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState('');
  const [proxyUser, setProxyUser] = useState('');
  const [proxyPass, setProxyPass] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [regUrl, setRegUrl] = useState('');
  const [regToken, setRegToken] = useState('');
  const [syncStatus, setSyncStatus] = useState('');

  // ── Load ──
  useEffect(() => {
    // @ts-ignore
    window.electronAPI.invoke('storage:get', 'settings').then((data: any) => {
      if (data) {
        if (data.proxy) {
          setProxyType(data.proxy.type || 'none');
          setProxyHost(data.proxy.host || '');
          setProxyPort(data.proxy.port || '');
          setProxyUser(data.proxy.user || '');
          setProxyPass(data.proxy.pass || '');
        }
        if (data.ui) {
          setTheme(data.ui.theme || 'dark');
          setLanguage(data.ui.language || 'zh');
        }
        if (data.system) {
          setAutoUpdate(data.system.autoUpdate ?? true);
          setAnalyticsEnabled(data.system.analyticsEnabled ?? false);
        }
        if (data.regplatform) {
          setRegUrl(data.regplatform.url || 'http://localhost:8080');
          setRegToken(data.regplatform.token || '');
        }
      }
    });
  }, []);

  // ── Save ──
  const saveSettings = (updates: any) => {
    // @ts-ignore
    window.electronAPI.invoke('storage:set', 'settings', updates);
    // Tell main process to update proxy if proxy settings are being saved
    if (updates.proxy) {
      // @ts-ignore
      window.electronAPI.invoke('proxy:apply', updates.proxy);
    }
  };

  const updateProxy = (updates: any) => {
    const cur = { type: proxyType, host: proxyHost, port: proxyPort, user: proxyUser, pass: proxyPass, ...updates };
    if (updates.type !== undefined) setProxyType(updates.type);
    if (updates.host !== undefined) setProxyHost(updates.host);
    if (updates.port !== undefined) setProxyPort(updates.port);
    if (updates.user !== undefined) setProxyUser(updates.user);
    if (updates.pass !== undefined) setProxyPass(updates.pass);
    saveSettings({ proxy: cur });
  };

  const handleSync = async () => {
    setSyncStatus('正在同步...');
    try {
      // @ts-ignore
      const res: any = await window.electronAPI.invoke('pool:sync-regplatform', { url: regUrl, token: regToken });
      if (res.success) {
        setSyncStatus(`✅ 成功导入 ${res.imported} 个账号`);
      } else {
        setSyncStatus(`❌ 同步失败: ${res.error}`);
      }
    } catch(e: any) {
      setSyncStatus(`❌ 致命错误: ${e.message}`);
    }
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ background: 'linear-gradient(135deg, #64748b, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            全局设置
          </h1>
          <p className="page-subtitle">代理、外观与系统配置</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>
        {/* Proxy Settings */}
        <div className="card">
          <div className="card-header"><span className="card-title">🌐 全局网络代理</span></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-group">
              <label className="label">代理类型</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {['none', 'http', 'socks5'].map(t => (
                  <button key={t} className={`btn btn-sm ${proxyType === t ? 'btn-primary' : 'btn-outline'}`} onClick={() => updateProxy({ type: t })} style={{ flex: 1 }}>
                    {t === 'none' ? '🚫 直连' : t === 'http' ? '🌐 HTTP' : '🧦 SOCKS5'}
                  </button>
                ))}
              </div>
            </div>
            {proxyType !== 'none' && (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div className="form-group" style={{ flex: 3 }}>
                    <label className="label">地址</label>
                    <input className="input" value={proxyHost} onChange={e => updateProxy({ host: e.target.value })} placeholder="127.0.0.1" />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="label">端口</label>
                    <input className="input" type="number" value={proxyPort} onChange={e => updateProxy({ port: e.target.value })} placeholder="7890" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="label">用户名 (可选)</label>
                    <input className="input" value={proxyUser} onChange={e => updateProxy({ user: e.target.value })} placeholder="user" />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="label">密码 (可选)</label>
                    <input className="input" type="password" value={proxyPass} onChange={e => updateProxy({ pass: e.target.value })} placeholder="••••" />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* RegPlatform Integration */}
        <div className="card" style={{ borderColor: 'rgba(56, 189, 248, 0.3)' }}>
          <div className="card-header"><span className="card-title">🏭 RegPlatform 生产端对接</span></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-group">
              <label className="label">RegPlatform API 地址</label>
              <input className="input" value={regUrl} onChange={e => {
                setRegUrl(e.target.value);
                saveSettings({ regplatform: { url: e.target.value, token: regToken } });
              }} placeholder="http://localhost:8080" />
            </div>
            <div className="form-group">
              <label className="label">登录 Token (Admin)</label>
              <input className="input" type="password" value={regToken} onChange={e => {
                setRegToken(e.target.value);
                saveSettings({ regplatform: { url: regUrl, token: e.target.value } });
              }} placeholder="ey..." />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
               <button className="btn btn-primary btn-sm" onClick={handleSync}>⬇️ 一键同步仓库账号</button>
               {syncStatus && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{syncStatus}</span>}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              点击同步将会从 RegPlatform 获取所有未归档的注册成果，存入本地账号池，并在远端标记为已归档。
            </p>
          </div>
        </div>

        {/* Appearance */}
        <div className="card">
          <div className="card-header"><span className="card-title">🎨 外观</span></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-group">
              <label className="label">主题</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className={`btn btn-sm ${theme === 'dark' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTheme('dark')} style={{ flex: 1 }}>🌙 深色</button>
                <button className={`btn btn-sm ${theme === 'light' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTheme('light')} style={{ flex: 1 }}>☀️ 浅色</button>
              </div>
            </div>
            <div className="form-group">
              <label className="label">语言</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className={`btn btn-sm ${language === 'zh' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setLanguage('zh')} style={{ flex: 1 }}>🇨🇳 中文</button>
                <button className={`btn btn-sm ${language === 'en' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setLanguage('en')} style={{ flex: 1 }}>🇺🇸 English</button>
              </div>
            </div>
          </div>
        </div>

        {/* System */}
        <div className="card">
          <div className="card-header"><span className="card-title">⚙️ 系统</span></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className={`toggle ${autoUpdate ? 'active' : 'inactive'}`} onClick={() => setAutoUpdate(!autoUpdate)}><span className="toggle-dot" /></button>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>自动检查更新</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className={`toggle ${analyticsEnabled ? 'active' : 'inactive'}`} onClick={() => setAnalyticsEnabled(!analyticsEnabled)}><span className="toggle-dot" /></button>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>发送匿名使用数据</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

