import { useState, useEffect } from 'react';

type OutlookTab = 'register' | 'forward' | 'verify';

export function OutlookToolboxPage() {
  const [tab, setTab] = useState<OutlookTab>('register');
  const [emails, setEmails] = useState('');
  const [forwardTo, setForwardTo] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  // Registration states
  const [regCount, setRegCount] = useState(5);
  const [regFormat, setRegFormat] = useState('auto_{{random}}');
  const [regPassword, setRegPassword] = useState('');

  const [verifyStats, setVerifyStats] = useState({ alive: 0, dead: 0 });

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 200));
  };

  useEffect(() => {
    const rmLog = window.electronAPI.on('outlook:log', (msg: any) => {
      addLog(String(msg));
    });
    const rmProg = window.electronAPI.on('outlook:verify:progress', (data: any) => {
      if (data.current === data.total && (data.text?.includes('结束') || data.text?.includes('停止'))) {
        setIsRunning(false);
      }
    });
    return () => {
      if (rmLog) rmLog();
      if (rmProg) rmProg();
    };
  }, []);

  const handleStart = async () => {
    setIsRunning(true);
    setLogs([]);
    
    if (tab === 'register') {
      addLog('🚀 初始化批量注册...');
      await window.electronAPI.invoke('outlook:register:start', { count: regCount, prefix: regFormat, password: regPassword });
    } else if (tab === 'forward') {
      if (!emails || !forwardTo) {
        addLog('❌ 请填写账号列表和目标转发邮箱');
        setIsRunning(false);
        return;
      }
      addLog('🚀 初始化批量转发配置...');
      await window.electronAPI.invoke('outlook:forward:setup', { emails: emails.split('\n'), targetEmail: forwardTo });
    } else if (tab === 'verify') {
      if (!emails) {
        addLog('❌ 请填写需验证的账号列表');
        setIsRunning(false);
        return;
      }
      addLog('🚀 初始化批量验证...');
      setVerifyStats({ alive: 0, dead: 0 });
      const res = (await window.electronAPI.invoke('outlook:verify:start', { emails: emails.split('\n') })) as any;
      if (res.success && res.results) {
        const aliveCount = res.results.filter((r: any) => r.status === 'alive').length;
        const deadCount = res.results.filter((r: any) => r.status === 'dead' || r.status === 'error').length;
        setVerifyStats({ alive: aliveCount, dead: deadCount });
      }
    }
  };

  const handleStop = () => {
    window.electronAPI.send('outlook:register:stop');
    setIsRunning(false);
    addLog('🛑 用户手动中止');
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Outlook 工具箱
          </h1>
          <p className="page-subtitle">Outlook 邮箱：注册 · 转发 · 验证</p>
        </div>
      </div>

      {/* Tab Switch */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 20px' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'register' as OutlookTab, label: '📝 批量注册', desc: '自动创建 Outlook 账号' },
            { id: 'forward' as OutlookTab, label: '📨 转发设置', desc: '设置邮件转发规则' },
            { id: 'verify' as OutlookTab, label: '✅ 批量验证', desc: '检测账号存活状态' },
          ].map(t => (
            <button
              key={t.id}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setTab(t.id)}
              style={{ flex: 1 }}
              disabled={isRunning}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="two-column">
        <div className="column-left">
          {/* Register Tab */}
          {tab === 'register' && (
            <div className="card">
              <div className="card-header"><span className="card-title">📝 批量注册配置</span></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label className="label">注册数量</label>
                  <input className="input" type="number" min={1} max={50} value={regCount} onChange={e => setRegCount(parseInt(e.target.value)||1)} disabled={isRunning} />
                </div>
                <div className="form-group">
                  <label className="label">邮箱前缀格式</label>
                  <input className="input" type="text" value={regFormat} onChange={e => setRegFormat(e.target.value)} placeholder="auto_{{random}}" disabled={isRunning} />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    {"使用 {{random}} 生成随机字符，{{num}} 生成数字"}
                  </div>
                </div>
                <div className="form-group">
                  <label className="label">密码</label>
                  <input className="input" type="text" value={regPassword} onChange={e => setRegPassword(e.target.value)} placeholder="留空自动生成" disabled={isRunning} />
                </div>
                <div className="alert info">
                  ⚠️ Outlook 注册可能触发手机验证或 CAPTCHA，需手动处理
                </div>
              </div>
            </div>
          )}

          {/* Forward Tab */}
          {tab === 'forward' && (
            <div className="card">
              <div className="card-header"><span className="card-title">📨 转发配置</span></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label className="label">账号列表（每行 邮箱----密码）</label>
                  <textarea className="input" value={emails} onChange={e => setEmails(e.target.value)} placeholder={"user1@outlook.com----password123\nuser2@outlook.com----password456"} rows={5} disabled={isRunning} />
                </div>
                <div className="form-group">
                  <label className="label">转发目标邮箱</label>
                  <input className="input" type="email" value={forwardTo} onChange={e => setForwardTo(e.target.value)} placeholder="接收转发邮件的地址" disabled={isRunning} />
                </div>
                <div className="alert info">
                  💡 将所有 Outlook 的验证码邮件统一转发到一个 IMAP 邮箱，简化注册流程
                </div>
              </div>
            </div>
          )}

          {/* Verify Tab */}
          {tab === 'verify' && (
            <div className="card">
              <div className="card-header"><span className="card-title">✅ 验证配置</span></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label className="label">账号列表（每行 邮箱----密码）</label>
                  <textarea className="input" value={emails} onChange={e => setEmails(e.target.value)} placeholder={"user1@outlook.com----password123"} rows={6} disabled={isRunning} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div className="badge green">活跃 {verifyStats.alive}</div>
                  <div className="badge purple">封禁或异常 {verifyStats.dead}</div>
                </div>
              </div>
            </div>
          )}

          {/* Action */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isRunning ? (
              <button className="btn btn-danger btn-full" onClick={handleStop}>■ 停止</button>
            ) : (
              <button className="btn btn-full" style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: 'white' }} onClick={handleStart}>
                ▶ {tab === 'register' ? '开始注册' : tab === 'forward' ? '设置转发' : '开始验证'}
              </button>
            )}
          </div>
        </div>

        <div className="column-right">
          <div className="log-viewer" style={{ height: 'calc(100vh - 160px)' }}>
            <div className="log-viewer-header">
              <span>📋 运行日志</span>
              <button className="btn btn-outline btn-sm" onClick={() => setLogs([])}>清空</button>
            </div>
            <div className="log-viewer-body" style={{ height: 'calc(100% - 44px)' }}>
              {logs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>暂无日志...</div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className={`log-line ${log.includes('✅') ? 'success' : log.includes('❌') ? 'error' : log.includes('⚠️') ? 'warning' : ''}`}>{log}</div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
