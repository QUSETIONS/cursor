import { useState } from 'react';

type TargetPlatform = 'cursor' | 'kiro' | 'windsurf';

const PLATFORM_META: Record<TargetPlatform, { label: string; emoji: string; gradient: string; desc: string }> = {
  cursor: { label: 'Cursor', emoji: '🖥️', gradient: 'linear-gradient(135deg, #8b5cf6, #a855f7)', desc: '替换 Cursor 本地认证信息' },
  kiro: { label: 'Kiro', emoji: '🎯', gradient: 'linear-gradient(135deg, #f97316, #ef4444)', desc: '替换 Kiro 本地 AWS Session' },
  windsurf: { label: 'Windsurf', emoji: '🏄', gradient: 'linear-gradient(135deg, #0ea5e9, #3b82f6)', desc: '替换 Windsurf 本地 Codeium 凭证' },
};

export function SwitchAccountPage() {
  const [platform, setPlatform] = useState<TargetPlatform>('cursor');
  const [mode, setMode] = useState<'pool' | 'manual'>('pool');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 200));
  };

  const handleSwitch = async () => {
    setIsRunning(true);
    addLog(`▶ 开始换号 (${PLATFORM_META[platform].label})...`);

    try {
      let targetToken = token;
      
      if (mode === 'pool') {
        addLog('🎲 正在向底座服务申请随机活跃代币...');
        // @ts-ignore
        const acc = (await window.electronAPI.invoke('pool:pull', { platform })) as any;
        if (!acc) {
          throw new Error('账号池中没有任何健康的账号，或全被封禁');
        }
        targetToken = acc.token || acc.password;
        addLog(`✅ 成功取得账号: ${acc.email} (Token: ${String(targetToken).substring(0, 8)}...)`);
      } else {
        addLog(`📋 使用手动 Token 注入。`);
      }

      addLog('🛠 执行底层指纹清洗与进程级接管...');
      if (platform === 'cursor') {
         const res = (await window.electronAPI.invoke('switch:reset-machine-id', targetToken)) as any;
         if (res.success) {
            addLog(`🚀 完美就绪！${res.message}`);
         } else {
            addLog(`⚠️ 配置已注入，但部分底层状态未响应`);
         }
      } else {
         addLog(`⚠️ 平台 ${platform} 的本地接管暂未彻底实现，当前仅支持 API 代理`);
      }

    } catch (err: any) {
      addLog(`❌ 致命错误: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const meta = PLATFORM_META[platform];

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ background: meta.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            一键换号
          </h1>
          <p className="page-subtitle">替换本地 IDE 认证信息，快速切换账号</p>
        </div>
      </div>

      <div className="two-column">
        <div className="column-left">
          {/* Platform Select */}
          <div className="card">
            <div className="card-header"><span className="card-title">🎯 选择平台</span></div>
            <div className="card-body" style={{ display: 'flex', gap: 8 }}>
              {(Object.entries(PLATFORM_META) as [TargetPlatform, typeof PLATFORM_META['cursor']][]).map(([key, val]) => (
                <button
                  key={key}
                  className={`btn ${platform === key ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setPlatform(key)}
                  style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, ...(platform === key ? { background: val.gradient } : {}) }}
                  disabled={isRunning}
                >
                  <span style={{ fontSize: 20 }}>{val.emoji}</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{val.label}</span>
                  <span style={{ fontSize: 9, color: platform === key ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>{val.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Switch Mode */}
          <div className="card">
            <div className="card-header"><span className="card-title">🔄 换号模式</span></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={`btn btn-sm ${mode === 'pool' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMode('pool')} style={{ flex: 1 }} disabled={isRunning}>
                  🎲 从账号池拉取
                </button>
                <button className={`btn btn-sm ${mode === 'manual' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMode('manual')} style={{ flex: 1 }} disabled={isRunning}>
                  ✏️ 手动输入
                </button>
              </div>

              {mode === 'pool' && (
                <div className="alert info" style={{ margin: 0 }}>
                  💡 将从账号池中随机拉取一个 <strong>{PLATFORM_META[platform].label}</strong> 活跃账号并自动替换本地凭证
                </div>
              )}

              {mode === 'manual' && (
                <>
                  <div className="form-group">
                    <label className="label">邮箱</label>
                    <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="account@example.com" disabled={isRunning} />
                  </div>
                  <div className="form-group">
                    <label className="label">Token / API Key</label>
                    <textarea className="input" value={token} onChange={e => setToken(e.target.value)} placeholder="粘贴 accessToken 或 API Key" rows={3} disabled={isRunning} />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Machine ID */}
          <div className="card">
            <div className="card-header"><span className="card-title">🔧 高级选项</span></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="reset-machine-id" defaultChecked />
                <label htmlFor="reset-machine-id" style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  重置 Machine ID（避免设备指纹关联）
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="clean-cache" />
                <label htmlFor="clean-cache" style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  清理本地缓存
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="restart-ide" defaultChecked />
                <label htmlFor="restart-ide" style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  换号后自动重启 IDE
                </label>
              </div>
            </div>
          </div>

          {/* Action */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isRunning ? (
              <button className="btn btn-danger btn-full" onClick={() => setIsRunning(false)}>■ 取消</button>
            ) : (
              <button className="btn btn-full" style={{ background: meta.gradient, color: 'white', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }} onClick={handleSwitch}>
                🔄 一键换号 ({PLATFORM_META[platform].label})
              </button>
            )}
          </div>
        </div>

        {/* Logs */}
        <div className="column-right">
          <div className="log-viewer" style={{ height: 'calc(100vh - 160px)' }}>
            <div className="log-viewer-header">
              <span>📋 执行日志</span>
              <button className="btn btn-outline btn-sm" onClick={() => setLogs([])}>清空</button>
            </div>
            <div className="log-viewer-body" style={{ height: 'calc(100% - 44px)' }}>
              {logs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>暂无日志...</div>
              ) : (
                logs.map((log, i) => (
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
