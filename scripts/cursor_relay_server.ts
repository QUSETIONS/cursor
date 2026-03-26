/**
 * Cursor Relay Station (本地中转站服务端)
 *
 * 功能说明：
 * 1. 模拟市面上的“Cursor 中转 / 公益站”的底层原理。
 * 2. 读取本地 data/tokens/ 目录下的所有可用 Cursor Token。
 * 3. 拦截 Cursor IDE 发出的 AI 对话请求 (拦截 /chat, /auth 等 API)。
 * 4. 动态擦除原有 Token，并随机/轮询注入我们池子里的有效 Token。
 * 5. 将请求无缝转发往官方 https://api2.cursor.sh 接口，并将响应流 (Stream) 原样透传回前端。
 * 
 * 运行： npx tsx scripts/cursor_relay_server.ts
 */

import express from 'express';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
const PORT = 5001;
const TARGET_API = 'https://api2.cursor.sh';
const TOKENS_DIR = path.resolve('data');

// ─── 1. Load Token Pool ───
let tokenPool: string[] = [];

function refreshTokens() {
  tokenPool = [];
  if (fs.existsSync(TOKENS_DIR)) {
    // 读取存放账号信息的汇总文件
    const accountsFile = path.join(TOKENS_DIR, 'accounts.json');
    if (fs.existsSync(accountsFile)) {
       try {
         const data = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
         if (data.accounts && Array.isArray(data.accounts)) {
             data.accounts.forEach((acc: any) => {
                 if (acc.token) tokenPool.push(acc.token.trim());
             });
         }
       } catch(e) {}
    }
    
    // 或者读取 .txt 单独文件
    const files = fs.readdirSync(TOKENS_DIR);
    for (const file of files) {
      if (file.endsWith('.txt')) {
        const content = fs.readFileSync(path.join(TOKENS_DIR, file), 'utf-8').trim();
        if (content.length > 50 && !tokenPool.includes(content)) {
          // Check if it looks like a JWT or WorkOS session token
          tokenPool.push(content);
        }
      }
    }
  }
  console.log(`[Relay Engine] Loaded ${tokenPool.length} active Cursor Tokens into the pool.`);
}

// 初始化加载 Token
refreshTokens();
setInterval(refreshTokens, 60000); // 每分钟自动热更新 Token 池

// ─── 2. Token Allocation Strategy ───
let tokenIndex = 0;
function getNextToken(): string | null {
  if (tokenPool.length === 0) return null;
  const token = tokenPool[tokenIndex % tokenPool.length];
  tokenIndex++;
  return token;
}

// ─── 3. Express App Setup ───
app.use(cors());
app.use(morgan('dev')); // 打印请求日志

// 健康检查接口
app.get('/health', (req, res) => {
  res.json({ status: 'ok', activeTokens: tokenPool.length, strategy: 'round-robin' });
});

// 手动刷新 Token 池接口
app.get('/refresh', (req, res) => {
  refreshTokens();
  res.json({ message: 'Tokens reloaded', count: tokenPool.length });
});

// ─── 4. Advanced Reverse Proxy Interceptor ───
app.use('/', createProxyMiddleware({
  target: TARGET_API,
  changeOrigin: true,
  ws: true, // 支持 WebSocket 透传
  logLevel: 'debug',
  
  // 关键步骤：在请求发往官方服务器前，篡改 HTTP Header 头
  onProxyReq: (proxyReq, req, res) => {
    // 注入负载均衡选出的 Token
    const assignedToken = getNextToken();
    if (assignedToken) {
      // 擦除客户端本来的 Bearer Token（不论是否到期），强行替换为我们的 Token 池
      proxyReq.setHeader('Authorization', `Bearer ${assignedToken}`);
      console.log(`[Proxy] Request intercepted: INJECTED Token [${assignedToken.substring(0, 15)}...]`);
    } else {
      console.log('[Proxy] No tokens available in pool! Forwarding raw request.');
    }

    // 可选：伪装源请求来源，防止封禁端点特征
    proxyReq.setHeader('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Cursor/0.45.1');
  },

  // 错误处理，防止服务端崩溃
  onError: (err, req, res) => {
    console.error('[Proxy Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Relay Station Internal Error', message: err.message }));
  }
}));

// ─── 5. Start Server ───
app.listen(PORT, () => {
  console.log('================================================================');
  console.log(`🚀 [Nirvana] Cursor API Relay Station is running on http://127.0.0.1:${PORT}`);
  console.log(`💡 To use this: Target your local proxy tool (or modify Cursor hosts/asar)`);
  console.log(`   to redirect [api2.cursor.sh] traffic to this Local Node.`);
  console.log('================================================================');
  if (tokenPool.length === 0) {
    console.log('⚠️ WARNING: The Token pool is currently Empty. Put valid tokens in data/*.txt');
  }
});
