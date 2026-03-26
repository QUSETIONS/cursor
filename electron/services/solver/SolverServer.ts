import express from 'express';
import { Logger } from '../../utils/Logger';
import { TurnstileSolver } from './TurnstileSolver';
import { ArkoseSolver } from './ArkoseSolver';

const PORT = process.env.SOLVER_PORT || 8191;
const turnstileSolver = new TurnstileSolver();
const arkoseSolver = new ArkoseSolver();
const logger = Logger.create('SolverServer');

const app = express();
app.use(express.json());

// FlareSolverr 风格的通用 /v1 接口
app.post('/v1', (req, res) => {
  // 兼容 FlareSolverr 的部分指令，但我们专门为了 Nirvana 优化
  const { cmd, url, maxTimeout, proxy } = req.body;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url parameter' });
  
  if (cmd !== 'request.get' && cmd !== 'turnstile') {
    return res.status(400).json({ status: 'error', message: 'Unsupported cmd' });
  }

  // 异步处理以满足 API 的立即响应或长轮询需求
  turnstileSolver.solve({ url, proxy: proxy?.url || proxy, timeoutMs: maxTimeout })
    .then(result => {
      if (result.status === 'success') {
        res.json({
          status: 'ok',
          message: 'Challenge solved!',
          solution: {
            url: url,
            userAgent: result.userAgent,
            token: result.token // The coveted cf-turnstile-response
          }
        });
      } else {
        res.status(500).json({
          status: 'error',
          message: result.error || 'Timeout or failure detecting challenge solution',
        });
      }
    })
    .catch(err => {
      res.status(500).json({ status: 'error', message: err.message });
    });
});

app.post('/v1/solve/arkose', (req, res) => {
  const { url, maxTimeout, proxy } = req.body;
  if (!url) return res.status(400).json({ status: 'error', message: 'Missing url parameter' });
  
  logger.info(`收到 Arkose 解析请求: ${url.substring(0, 50)}...`);
  
  arkoseSolver.solve({ url, proxy: proxy?.url || proxy, timeoutMs: maxTimeout })
    .then(result => {
      if (result.status === 'success') {
        res.json({
          status: 'ok',
          message: 'Arkose solved!',
          solution: { token: result.token }
        });
      } else {
        res.status(500).json({ status: 'error', message: result.error || 'Failed to extract Arkose token' });
      }
    })
    .catch(err => res.status(500).json({ status: 'error', message: err.message }));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0-nirvana', engine: 'playwright-stealth' });
});

export function startSolverServer() {
  app.listen(PORT, () => {
    logger.info(`🚀 Nirvana Foundry (Solver API) is running on http://localhost:${PORT}`);
  });
}

// 允许独立启动
if (require.main === module) {
  startSolverServer();
}
