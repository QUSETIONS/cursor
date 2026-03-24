import { useState, useEffect } from 'react';

type Platform = 'cursor' | 'kiro' | 'windsurf' | 'all';
type AccountStatus = 'active' | 'expired' | 'suspended' | 'unverified';

interface PoolAccount {
  id: string;
  platform: string;
  email: string;
  password: string;
  token?: string;
  apiKey?: string;
  status: AccountStatus;
  plan?: string;
  createdAt: string;
  lastUsedAt?: string;
}

const PLATFORM_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  cursor: { bg: 'rgba(139,92,246,0.2)', text: '#a78bfa', label: 'Cursor' },
  kiro: { bg: 'rgba(249,115,22,0.2)', text: '#fb923c', label: 'Kiro' },
  windsurf: { bg: 'rgba(14,165,233,0.2)', text: '#38bdf8', label: 'Windsurf' },
};

const STATUS_DOTS: Record<AccountStatus, string> = {
  active: 'success',
  expired: 'unknown',
  suspended: 'fail',
  unverified: 'testing',
};

export function AccountPoolPage() {
  const [accounts, setAccounts] = useState<PoolAccount[]>([]);
  const [filter, setFilter] = useState<Platform>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [importPlatform, setImportPlatform] = useState<'cursor' | 'kiro' | 'windsurf'>('cursor');

  // Stats
  const stats = {
    total: accounts.length,
    active: accounts.filter(a => a.status === 'active').length,
    suspended: accounts.filter(a => a.status === 'suspended').length,
    cursor: accounts.filter(a => a.platform === 'cursor').length,
    kiro: accounts.filter(a => a.platform === 'kiro').length,
    windsurf: accounts.filter(a => a.platform === 'windsurf').length,
  };

  // Filtered list
  const filtered = accounts
    .filter(a => filter === 'all' || a.platform === filter)
    .filter(a => !search || a.email.toLowerCase().includes(search.toLowerCase()));

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(a => a.id)));
    }
  };

  const deleteSelected = () => {
    setAccounts(prev => prev.filter(a => !selected.has(a.id)));
    setSelected(new Set());
  };

  return (
    <div className="animate-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ background: 'linear-gradient(135deg, #10b981, #059669)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            账号池管理
          </h1>
          <p className="page-subtitle">管理所有平台的注册账号库存</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {[
          { label: '总计', value: stats.total, color: 'var(--text-primary)' },
          { label: '活跃', value: stats.active, color: 'var(--success)' },
          { label: '封禁', value: stats.suspended, color: 'var(--danger)' },
          { label: 'Cursor', value: stats.cursor, color: '#a78bfa' },
          { label: 'Kiro', value: stats.kiro, color: '#fb923c' },
          { label: 'Windsurf', value: stats.windsurf, color: '#38bdf8' },
        ].map(s => (
          <div key={s.label} className="card" style={{ flex: 1, padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Platform filter */}
          {(['all', 'cursor', 'kiro', 'windsurf'] as Platform[]).map(p => (
            <button key={p} className={`btn btn-sm ${filter === p ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter(p)}>
              {p === 'all' ? '🌐 全部' : `${PLATFORM_COLORS[p]?.label || p}`}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          {/* Search */}
          <input className="input" type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜索邮箱" style={{ width: 200 }} />

          {/* Actions */}
          <button className="btn btn-outline btn-sm" onClick={() => setShowImport(!showImport)}>📥 导入</button>
          <button className="btn btn-outline btn-sm" onClick={() => {
            // Export selected or all filtered
            const data = (selected.size > 0 ? filtered.filter(a => selected.has(a.id)) : filtered)
              .map(a => `${a.email}----${a.password}----${a.token || ''}----${a.apiKey || ''}`)
              .join('\n');
            navigator.clipboard.writeText(data);
          }}>📤 导出</button>

          {selected.size > 0 && (
            <button className="btn btn-sm" onClick={deleteSelected} style={{ color: 'var(--danger)', border: '1px solid var(--danger)', background: 'transparent' }}>
              🗑️ 删除 ({selected.size})
            </button>
          )}
        </div>

        {/* Import panel */}
        {showImport && (
          <div style={{ marginTop: 12, padding: 12, border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 10 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <label className="label" style={{ marginBottom: 0, alignSelf: 'center' }}>平台:</label>
              {(['cursor', 'kiro', 'windsurf'] as const).map(p => (
                <button key={p} className={`btn btn-sm ${importPlatform === p ? 'btn-primary' : 'btn-outline'}`} onClick={() => setImportPlatform(p)}>
                  {PLATFORM_COLORS[p].label}
                </button>
              ))}
            </div>
            <textarea className="input" placeholder={"格式：邮箱----密码----token----apiKey\n每行一个\n例如：\nuser@gmail.com----pass123----token----key"} rows={4} />
            <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>确认导入</button>
          </div>
        )}
      </div>

      {/* Account Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        {/* Table Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', userSelect: 'none' }}>
          <div style={{ width: 32 }}>
            <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={selectAll} />
          </div>
          <div style={{ width: 80 }}>平台</div>
          <div style={{ flex: 1 }}>邮箱</div>
          <div style={{ width: 60 }}>状态</div>
          <div style={{ width: 60 }}>套餐</div>
          <div style={{ width: 100 }}>创建时间</div>
          <div style={{ width: 60 }}>操作</div>
        </div>

        {/* Table Body */}
        <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {accounts.length === 0 ? '账号池为空，点击「导入」添加账号' : '无匹配结果'}
            </div>
          ) : (
            filtered.map(acc => {
              const pc = PLATFORM_COLORS[acc.platform] || { bg: 'rgba(255,255,255,0.1)', text: 'var(--text-muted)', label: acc.platform };
              return (
                <div key={acc.id} style={{
                  display: 'flex', alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: selected.has(acc.id) ? 'rgba(139,92,246,0.08)' : 'transparent',
                  transition: 'background 0.15s',
                }} onMouseEnter={e => { if (!selected.has(acc.id)) (e.currentTarget.style.background = 'rgba(255,255,255,0.03)'); }}
                   onMouseLeave={e => { if (!selected.has(acc.id)) (e.currentTarget.style.background = 'transparent'); }}>
                  <div style={{ width: 32 }}>
                    <input type="checkbox" checked={selected.has(acc.id)} onChange={() => toggleSelect(acc.id)} />
                  </div>
                  <div style={{ width: 80 }}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: pc.bg, color: pc.text }}>{pc.label}</span>
                  </div>
                  <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {acc.email}
                  </div>
                  <div style={{ width: 60 }}>
                    <span className={`status-dot ${STATUS_DOTS[acc.status]}`} />
                  </div>
                  <div style={{ width: 60, fontSize: 10, color: 'var(--text-muted)' }}>{acc.plan || 'free'}</div>
                  <div style={{ width: 100, fontSize: 10, color: 'var(--text-muted)' }}>
                    {new Date(acc.createdAt).toLocaleDateString('zh-CN')}
                  </div>
                  <div style={{ width: 60, display: 'flex', gap: 4 }}>
                    <button className="btn btn-outline btn-sm" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => navigator.clipboard.writeText(`${acc.email}----${acc.password}----${acc.token || ''}`)}>📋</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
