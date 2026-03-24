/**
 * Mock Vulnerable API Relay Station (For Educational/Audit Testing Only)
 * 这是一个极其简化的中转站网关模拟器，故意带有了我们在之前分析中提到的所有漏洞特征。
 * 它可以安全地被 RelayStationAuditor 扫描，以展示“黑客攻击”的实际效果。
 */
import express from 'express';
const app = express();
app.use(express.json());

// 模拟的自建渠道号池 (真实的上游 Keys)
const UPSTREAM_CHANNELS = [
  { id: 1, type: 'openai', key: 'sk-real-upstream-openai-key-999', baseUrl: 'https://api.openai.com' },
  { id: 2, type: 'cursor', key: 'WorkosCursorSessionToken=user_123_abc', baseUrl: 'https://api2.cursor.sh' }
];

// 漏洞 1: 弱口令管理员鉴权
app.post('/api/user/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'root' && password === '123456') {
    res.json({ success: true, message: '登录成功', data: { token: 'admin_mock_token' } });
  } else {
    res.status(401).json({ success: false, message: '密码错误' });
  }
});

// 漏洞 2: 未授权访问 (BOLA) - 渠道列表裸奔
app.get('/api/channel/', (req, res) => {
  // 原本应该检查 req.headers.authorization，但这里故意越权
  res.json({
    success: true,
    message: '获取成功',
    data: UPSTREAM_CHANNELS
  });
});

// 漏洞 3: 上游渠道信息泄露 (Channel Leakage)
app.post('/v1/chat/completions', (req, res) => {
  const { max_tokens } = req.body;
  
  if (max_tokens > 100000) {
    // 故意将上游报错信息原样抛出，导致真实 Upstream 和 Key 泄露
    res.status(500).json({
      error: {
        message: 'Upstream Provider Error: OpenAI Rate Limit Exceeded',
        type: 'upstream_error',
        provider_url: UPSTREAM_CHANNELS[0].baseUrl,
        failed_key: UPSTREAM_CHANNELS[0].key
      }
    });
  } else {
    res.json({
      id: "chatcmpl-mock",
      object: "chat.completion",
      choices: [{ message: { role: 'assistant', content: 'Mock response' } }]
    });
  }
});

app.listen(3000, () => {
  console.log('[MockRelay] 存在漏洞的模拟中转站已启动 (http://localhost:3000)');
  console.log('[MockRelay] 故意暴露了 root:123456 弱口令、BOLA 越权和 Error 渠道泄露');
});
