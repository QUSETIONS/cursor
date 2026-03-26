import React, { useState, useEffect, useRef } from 'react';
import { Channels } from '../../electron/ipc/channels';

// --- Types ---
interface FoundryStatus { running: boolean; port: number; }
interface FleetStatus { running: boolean; totalProxies: number; fastLaneCount: number; }
interface ProxyStats { total: number; healthy: number; topNodes: Array<{ host: string; port: number; qualityScore: number; protocol: string }>; }
interface AccountStats { email: string; createdAt: string; success: boolean; error?: string; token?: string; targetUrl: string; proxyIp?: string }

export function DashboardPage() {
  const [foundryStatus, setFoundryStatus] = useState<FoundryStatus>({ running: false, port: 0 });
  const [fleetStatus, setFleetStatus] = useState<FleetStatus>({ running: true, totalProxies: 0, fastLaneCount: 0 });
  const [proxyStats, setProxyStats] = useState<ProxyStats>({ total: 0, healthy: 0, topNodes: [] });
  const [recentAccounts, setRecentAccounts] = useState<AccountStats[]>([]);
  const [gatlingRunning, setGatlingRunning] = useState(false);
  const [targetPlatform, setTargetPlatform] = useState('cursor');
  const [targetCount, setTargetCount] = useState(3);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Poll status every 3 seconds
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const _foundry = await window.electronAPI.invoke(Channels.ENGINE_FOUNDRY_STATUS);
        const _fleet = await window.electronAPI.invoke(Channels.ENGINE_GHOSTFLEET_STATUS);
        const _pStats = await window.electronAPI.invoke('get-proxy-stats');
        const _accounts = await window.electronAPI.invoke('get-recent-accounts');
        if (_foundry) setFoundryStatus(_foundry as FoundryStatus);
        if (_fleet) setFleetStatus(_fleet as FleetStatus);
        if (_pStats) setProxyStats(_pStats as ProxyStats);
        if (_accounts) setRecentAccounts(_accounts as AccountStats[]);
      } catch (err) {
        console.error('Status fetch failed', err);
      }
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 3000);
    return () => clearInterval(timer);
  }, []);

  // Listen to Global Logs
  useEffect(() => {
    const cleanup = window.electronAPI.on(Channels.ENGINE_GLOBAL_LOG, (...args: unknown[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : String(args[0]);
      setLogs((prev) => {
        const next = [...prev, msg];
        if (next.length > 200) next.shift(); // Keep last 200 logs
        return next;
      });
    });
    return cleanup;
  }, []);

  // Auto scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleStartFoundry = async () => {
    await window.electronAPI.invoke(Channels.ENGINE_FOUNDRY_START);
    setFoundryStatus((prev) => ({ ...prev, running: true }));
  };

  const handleToggleFleet = async () => {
    if (fleetStatus.running) {
      await window.electronAPI.invoke(Channels.ENGINE_GHOSTFLEET_STOP);
      setFleetStatus((prev) => ({ ...prev, running: false }));
    } else {
      await window.electronAPI.invoke(Channels.ENGINE_GHOSTFLEET_START);
      setFleetStatus((prev) => ({ ...prev, running: true }));
    }
  };

  const handleStartGatling = async () => {
    if (gatlingRunning) {
      await window.electronAPI.invoke(Channels.REGISTER_STOP);
      setGatlingRunning(false);
    } else {
      setGatlingRunning(true);
      try {
        await window.electronAPI.invoke(Channels.REGISTER_AUTO, {
          platform: targetPlatform,
          count: targetCount
        });
      } finally {
        setGatlingRunning(false);
      }
    }
  };



  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
      
      {/* 顶部状态卡片区 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        {/* The Foundry Card */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: 20
        }}>
          <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            🏭 The Foundry <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>打码中心</span>
          </h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>状态</div>
              <div style={{ color: foundryStatus.running ? '#10b981' : '#f43f5e', fontWeight: 600, marginTop: 4 }}>
                {foundryStatus.running ? `Running (Port ${foundryStatus.port})` : 'Offline'}
              </div>
            </div>
            <button 
              onClick={handleStartFoundry}
              disabled={foundryStatus.running}
              style={{
                background: foundryStatus.running ? 'rgba(255,255,255,0.1)' : '#10b981',
                border: 'none',
                color: 'white',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: foundryStatus.running ? 'not-allowed' : 'pointer',
                fontWeight: 600
              }}>
              {foundryStatus.running ? 'ACTIVE' : 'START SOLVER'}
            </button>
          </div>
        </div>

        {/* The Ghost Fleet Card */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: 20
        }}>
          <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            ⛴️ The Ghost Fleet <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>幽灵代理池</span>
          </h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>状态</div>
                <div style={{ color: fleetStatus.running ? '#10b981' : '#f43f5e', fontWeight: 600, marginTop: 4 }}>
                  {fleetStatus.running ? `Running` : 'Offline'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>全网可用节点</div>
                <div style={{ color: 'white', fontWeight: 600, fontSize: 18, marginTop: 2 }}>
                  {fleetStatus.totalProxies} <span style={{fontSize: 12, color:'var(--text-muted)'}}>IPs</span>
                </div>
              </div>
            </div>
            <button 
              onClick={handleToggleFleet}
              style={{
                background: fleetStatus.running ? '#f43f5e' : '#10b981',
                border: 'none',
                color: 'white',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 600
              }}>
              {fleetStatus.running ? 'STOP FLEET' : 'START FLEET'}
            </button>
          </div>
        </div>

        {/* The Gatling Gun Stats Card */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: 20
        }}>
          <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            🎯 Gatling Gun <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>核心引擎</span>
          </h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 24 }}>
               <div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>最近注册成功率</div>
                  <div style={{ color: 'white', fontWeight: 600, fontSize: 18, marginTop: 2 }}>
                    {recentAccounts.length > 0 ? Math.round((recentAccounts.filter(a => a.success).length / recentAccounts.length) * 100) : 0}% <span style={{fontSize: 12, color:'var(--text-muted)'}}>({recentAccounts.length}次)</span>
                  </div>
               </div>
               <div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>幽灵船可用数</div>
                  <div style={{ color: '#10b981', fontWeight: 600, fontSize: 18, marginTop: 2 }}>
                    {proxyStats.healthy} <span style={{fontSize: 12, color:'var(--text-muted)'}}>健康</span>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* 实时终端区域 */}
      <div style={{
         flex: 1, 
         background: '#09090b', 
         borderRadius: 12, 
         border: '1px solid rgba(34, 197, 94, 0.3)', 
         overflow: 'hidden',
         display: 'flex',
         flexDirection: 'column',
         boxShadow: '0 0 20px rgba(34,197,94,0.05)'
      }}>
        <div style={{ 
          background: 'rgba(34,197,94,0.1)', 
          padding: '8px 16px', 
          borderBottom: '1px solid rgba(34,197,94,0.2)',
          color: '#22c55e',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'monospace',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span>&gt;_ GLOBAL RUNTIME TRACE</span>
          <span className="animate-pulse">● LIVE</span>
        </div>
        <div style={{
          flex: 1,
          padding: 16,
          overflowY: 'auto',
          fontFamily: 'Consolas, Monaco, "Courier New", monospace',
          fontSize: 13,
          color: '#a1a1aa',
          lineHeight: 1.6
        }}>
          {logs.length === 0 ? (
            <div style={{ color: '#52525b', fontStyle: 'italic' }}>Waiting for system events...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} style={{ 
                color: log.includes('ERROR') || log.includes('❌') ? '#ef4444' : 
                       log.includes('WARN') ? '#eab308' : 
                       log.includes('INFO') || log.includes('✅') ? '#a1a1aa' : '#22c55e',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                marginBottom: 2
              }}>
                {log}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

    </div>
  );
}
