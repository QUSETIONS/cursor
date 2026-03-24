import { useState, useEffect } from 'react';
import { Channels } from '../electron/ipc/channels';
import { RegistrationPage } from './pages/RegistrationPage';
import { KiroRegisterPage } from './pages/KiroRegisterPage';
import { WindsurfRegisterPage } from './pages/WindsurfRegisterPage';
import { OutlookToolboxPage } from './pages/OutlookToolboxPage';
import { AccountPoolPage } from './pages/AccountPoolPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { SwitchAccountPage } from './pages/SwitchAccountPage';
import { SettingsPage } from './pages/SettingsPage';

type Route =
  | 'cursor-register'
  | 'kiro-register'
  | 'windsurf-register'
  | 'switch-account'
  | 'outlook'
  | 'account-pool'
  | 'admin'
  | 'settings';

interface NavSection {
  label: string;
  items: { id: Route; label: string; emoji: string; color: string }[];
}

const NAV: NavSection[] = [
  {
    label: '批量注册',
    items: [
      { id: 'cursor-register', label: 'Cursor', emoji: '🖥️', color: '#8b5cf6' },
      { id: 'kiro-register', label: 'Kiro', emoji: '🎯', color: '#f97316' },
      { id: 'windsurf-register', label: 'Windsurf', emoji: '🏄', color: '#0ea5e9' },
    ],
  },
  {
    label: '账号工具',
    items: [
      { id: 'switch-account', label: '一键换号', emoji: '🔄', color: '#14b8a6' },
      { id: 'outlook', label: 'Outlook 工具', emoji: '📧', color: '#3b82f6' },
      { id: 'account-pool', label: '账号池', emoji: '📦', color: '#10b981' },
    ],
  },
  {
    label: '系统',
    items: [
      { id: 'admin', label: '管理后台', emoji: '🔐', color: '#6366f1' },
      { id: 'settings', label: '设置', emoji: '⚙️', color: '#64748b' },
    ],
  },
];

export default function App() {
  const [route, setRoute] = useState<Route>('cursor-register');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const cleanup = window.electronAPI.on(Channels.REGISTER_PROGRESS, (data) => {
      console.log('[Progress]', data);
    });
    return cleanup;
  }, []);

  return (
    <div className="app-container">
      {/* Title Bar */}
      <div className="app-titlebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }}
          >
            ☰
          </button>
          <span className="app-titlebar-title">✦ NIRVANA v3.0</span>
        </div>
        <div className="app-titlebar-controls">
          <button className="app-titlebar-btn minimize" onClick={() => window.electronAPI.invoke(Channels.WINDOW_MINIMIZE)} />
          <button className="app-titlebar-btn maximize" onClick={() => window.electronAPI.invoke(Channels.WINDOW_MAXIMIZE)} />
          <button className="app-titlebar-btn close" onClick={() => window.electronAPI.invoke(Channels.WINDOW_CLOSE)} />
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <aside style={{
          width: sidebarCollapsed ? 56 : 200,
          minWidth: sidebarCollapsed ? 56 : 200,
          background: 'rgba(255,255,255,0.02)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
        }}>
          <nav style={{ flex: 1, padding: '8px 6px', overflowY: 'auto' }}>
            {NAV.map((section) => (
              <div key={section.label} style={{ marginBottom: 12 }}>
                {!sidebarCollapsed && (
                  <div style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: 1.5,
                    padding: '6px 10px 2px',
                  }}>
                    {section.label}
                  </div>
                )}
                {section.items.map((item) => {
                  const isActive = route === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setRoute(item.id)}
                      title={sidebarCollapsed ? item.label : undefined}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        padding: sidebarCollapsed ? '8px 0' : '7px 10px',
                        justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        borderRadius: 8,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: isActive ? 700 : 500,
                        fontFamily: 'inherit',
                        color: isActive ? 'white' : 'var(--text-secondary)',
                        background: isActive
                          ? `linear-gradient(135deg, ${item.color}cc, ${item.color}99)`
                          : 'transparent',
                        boxShadow: isActive ? `0 2px 8px ${item.color}33` : 'none',
                        transition: 'all 0.2s',
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ fontSize: 14, lineHeight: 1 }}>{item.emoji}</span>
                      {!sidebarCollapsed && <span>{item.label}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Sidebar footer */}
          <div style={{
            padding: sidebarCollapsed ? '12px 0' : '12px 16px',
            borderTop: '1px solid var(--border)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: 1 }}>
              {sidebarCollapsed ? 'v3' : 'NIRVANA v3.0'}
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="main-content" style={{ flex: 1, overflow: 'auto' }}>
          {route === 'cursor-register' && <RegistrationPage />}
          {route === 'kiro-register' && <KiroRegisterPage />}
          {route === 'windsurf-register' && <WindsurfRegisterPage />}
          {route === 'switch-account' && <SwitchAccountPage />}
          {route === 'outlook' && <OutlookToolboxPage />}
          {route === 'account-pool' && <AccountPoolPage />}
          {route === 'admin' && <AdminDashboardPage />}
          {route === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
