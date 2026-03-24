import { useState, useEffect } from 'react';

interface DashboardStats {
  totalUsers: number;
  activeToday: number;
  totalRevenue: number;
  poolStock: Record<string, Record<string, number>>;
}

const MOCK_STATS: DashboardStats = {
  totalUsers: 0,
  activeToday: 0,
  totalRevenue: 0,
  poolStock: {
    cursor: { FREE: 0, PRO: 0 },
    kiro: { FREE: 0, PRO: 0 },
    windsurf: { FREE: 0, PRO: 0, TEAM: 0 },
  },
};

export function AdminDashboardPage() {
    const [stats, setStats] = useState<DashboardStats>(MOCK_STATS);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Try to auto-login using settings
    // @ts-ignore
    window.electronAPI.invoke('storage:get', 'settings').then((data: any) => {
      if (data && data.regplatform && data.regplatform.url && data.regplatform.token) {
        setApiUrl(data.regplatform.url);
        setToken(data.regplatform.token);
        setIsLoggedIn(true);
      }
    });
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      fetchStats();
      const interval = setInterval(fetchStats, 10000); // refresh every 10s
      return () => clearInterval(interval);
    }
  }, [isLoggedIn, apiUrl, token]);

  const fetchStats = async () => {
    try {
      // 1. Get Local Pool Stats
      // @ts-ignore
      const localStats = (await window.electronAPI.invoke('pool:stats')) as any;
      
      const poolStock: Record<string, Record<string, number>> = {
        cursor: { ACTIVE: localStats?.byPlatform?.cursor || 0 },
        windsurf: { ACTIVE: localStats?.byPlatform?.windsurf || 0 },
        kiro: { ACTIVE: localStats?.byPlatform?.kiro || 0 },
        warp: { ACTIVE: localStats?.byPlatform?.warp || 0 }
      };

      // 2. Try to get RegPlatform Unarchived Count (simulate real-time stock)
      let remoteUnarchived = 0;
      if (apiUrl && token) {
        try {
          const normUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
          const res = await fetch(`${normUrl}/api/results?page_size=1`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            remoteUnarchived = data.total || 0;
            // Add a special category for remote stock
            poolStock.remote_unarchived = { AVAILABLE: remoteUnarchived };
          }
        } catch (e) {
          console.warn('Failed to fetch remote RegPlatform stats', e);
        }
      }

      setStats({
        totalUsers: 0, // Placeholder
        activeToday: 0, // Placeholder
        totalRevenue: 0, // Placeholder
        poolStock
      });

    } catch (e) {
      console.error('Error fetching dashboard stats', e);
    }
  };

  const handleLogin = () => {
    if (!apiUrl || !token) {
      setLoginError('请填写完整信息');
      return;
    }
    setIsLoggedIn(true);
    setLoginError('');
  };

  // ─── Login Screen ───
  if (!isLoggedIn) {
    return (
      <div className="animate-in" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 120px)' }}>
        <div className="card" style={{ width: 400, padding: 0 }}>
          <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>🔐 管理后台</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>登录 RegPlatform API</p>
          </div>
          <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-group">
              <label className="label">RegPlatform API 地址</label>
              <input className="input" type="url" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="http://localhost:8080" />
            </div>
            <div className="form-group">
              <label className="label">API Token</label>
              <input className="input" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            </div>
            {loginError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>❌ {loginError}</div>}
            <button className="btn btn-primary btn-full" onClick={handleLogin}>登 录</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Dashboard ───
  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ background: 'linear-gradient(135deg, #10b981, #14b8a6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            管理后台
          </h1>
          <p className="page-subtitle">系统数据概览与管理</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => setIsLoggedIn(false)}>退出 ↗</button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        {[
          { label: '本地总账号数', value: Object.values(stats.poolStock).filter(p => p !== stats.poolStock.remote_unarchived).reduce((sum, p) => sum + Object.values(p).reduce((s, v) => s + v, 0), 0), icon: '👥', gradient: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))' },
          { label: '远端未提取数', value: stats.poolStock.remote_unarchived?.AVAILABLE || 0, icon: '☁️', gradient: 'linear-gradient(135deg, rgba(14,165,233,0.15), rgba(59,130,246,0.15))' },
          { label: '今日净增', value: stats.activeToday, icon: '📈', gradient: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.15))' },
          { label: '总库存', value: Object.values(stats.poolStock).reduce((sum, p) => sum + Object.values(p).reduce((s, v) => s + v, 0), 0), icon: '📦', gradient: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(20,184,166,0.15))' },
        ].map(card => (
          <div key={card.label} className="card" style={{ padding: 20, background: card.gradient }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>{card.label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>{card.value.toLocaleString()}</div>
              </div>
              <span style={{ fontSize: 24 }}>{card.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Pool Stock */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><span className="card-title">📦 账号库存动态 (本地+远端)</span></div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {Object.entries(stats.poolStock).map(([platform, types]) => (
              <div key={platform} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 16, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10, textTransform: 'capitalize' }}>
                  {platform === 'cursor' ? '🖥️' : platform === 'kiro' ? '🎯' : platform === 'windsurf' ? '🏄' : platform === 'remote_unarchived' ? '☁️' : '📦'} {platform.replace('_', ' ')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {Object.entries(types).map(([type, count]) => (
                    <div key={type} style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', fontSize: 11, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{type}</span>
                      <span style={{ fontWeight: 700, color: count > 0 ? 'var(--success)' : 'var(--danger)' }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <div className="card-header"><span className="card-title">⚡ 快速操作 & 并发控制</span></div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { label: '一键拉取远端账号', desc: '触发 pool:sync-regplatform', icon: '⬇️', action: () => {
                // @ts-ignore
                window.electronAPI.invoke('pool:sync-regplatform', { url: apiUrl, token: token }).then(res => alert(res.success ? `成功导入: ${res.imported}` : `失败: ${res.error}`));
              }},
              { label: '启动注册管线 (3并发)', desc: '触发 register:start', icon: '🚀', action: () => {
                // @ts-ignore
                window.electronAPI.invoke('register:start', { concurrency: 3 });
              }},
              { label: '停止所有注册任务', desc: '触发 register:stop', icon: '🛑', action: () => {
                // @ts-ignore
                window.electronAPI.invoke('register:stop');
              }},
            ].map(action => (
              <button key={action.label} onClick={action.action} className="card" style={{ padding: 16, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border)', transition: 'all 0.2s', background: 'transparent' }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{action.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{action.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{action.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
