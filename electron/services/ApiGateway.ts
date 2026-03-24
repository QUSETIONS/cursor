/**
 * ApiGateway — Inspired by flow2api's OpenAI-compatible API gateway
 * Serves registered account tokens as an OpenAI-compatible API endpoint.
 * Supports load-balanced token rotation, request proxying, and /v1/chat/completions format.
 *
 * This runs as an embedded HTTP server inside the Electron app,
 * allowing local tools to consume IDE accounts as if they were API keys.
 */

import express from 'express';
import { createLogger } from '../utils/Logger';
import type { TokenRefreshService } from '../services/TokenRefreshService';
import { handleOpenAIChatCompletions } from './proxy-cursor/openai-handler';
import { handleGeminiChatCompletions } from './proxy-gemini/gemini-handler';

export interface ApiGatewayConfig {
  port: number;               // default 18080
  host: string;               // default 127.0.0.1
  enableLogging: boolean;
}

const DEFAULT_CONFIG: ApiGatewayConfig = {
  port: 18080,
  host: '0.0.0.0', // Bind to all interfaces for Docker/Cloud compatibility
  enableLogging: true,
};

// ─── Sinkhole Protection (Rate Limiter) ───
class GlobalRateLimiter {
  private requests: number = 0;
  private lastReset: number = Date.now();
  constructor(private maxRequestsPerMinute: number) {}
  
  checkLimit(): boolean {
    const now = Date.now();
    if (now - this.lastReset > 60000) {
      this.requests = 0;
      this.lastReset = now;
    }
    this.requests++;
    return this.requests <= this.maxRequestsPerMinute;
  }
}

export class ApiGateway {
  private server?: any;
  private config: ApiGatewayConfig;
  private tokenService: TokenRefreshService;
  private log = createLogger('APIGateway');
  private rateLimiter: GlobalRateLimiter;

  constructor(tokenService: TokenRefreshService, config?: Partial<ApiGatewayConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokenService = tokenService;
    this.rateLimiter = new GlobalRateLimiter(600); // Max 600 reqs/min by default to prevent burst sinkholing
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const app = express();
      
      app.use(express.json({ limit: '50mb' }));

      // CORS
      app.use((_req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', '*');
        if (_req.method === 'OPTIONS') {
          res.sendStatus(200);
          return;
        }
        next();
      });

      // Health
      app.get('/health', (_req, res) => {
        res.json({ status: 'ok', uptime: process.uptime() });
      });

      // Route setup
      app.post('/v1/chat/completions', async (req, res) => {
        // Global Rate Limiting Hook (429 Sinkhole Protection)
        if (!this.rateLimiter.checkLimit()) {
          this.log.warn('Global rate limit hit (sinkhole protection activated). Dropping request.');
          res.status(429).json({ error: { message: 'Gateway Rate Limit Exceeded - Too Many Requests' } });
          return;
        }

        try {
          const model = req.body.model || '';
          const platform = model.replace('-proxy', '').toLowerCase() || 'cursor';

          // Native translation pipeline hook
          if (platform === 'cursor') {
            // Get healthy token from our internal pool or use fallback for load testing
            let tokenRecord = this.tokenService.getNextToken('cursor');
            let actualToken = tokenRecord?.accessToken;
            
            if (!actualToken) {
              this.log.error('Rejecting request: No active tokens available in SQLite pool for cursor');
              res.status(503).json({ error: { message: 'No available tokens for Cursor proxy' } });
              return;
            }

            // Inject the token into the request header so the imported cursor2api handler sees it
            req.headers['authorization'] = `Bearer ${actualToken}`;
            
            // Delegate the heavy lifting of streaming and protocol translation to cursor2api
            await handleOpenAIChatCompletions(req, res);
            return;

          } else if (platform === 'gemini') {
            let tokenRecord = this.tokenService.getNextToken('gemini');
            let actualToken = tokenRecord?.accessToken;
            
            if (!actualToken) {
              this.log.error('Rejecting request: No active tokens available in SQLite pool for gemini');
              res.status(503).json({ error: { message: 'No available tokens for Gemini proxy' } });
              return;
            }

            req.headers['authorization'] = `Bearer ${actualToken}`;
            await handleGeminiChatCompletions(req, res);
            return;
            
          } else {
            // Raw proxy pass-through or original handler
            res.status(501).json({ error: { message: `Platform router ${platform} not recognized` } });
            return;
          }

        } catch (err: any) {
          this.log.error('Gateway Error:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: err.message });
          }
        }
      });

      this.server = app.listen(this.config.port, this.config.host, () => {
        this.log.info(`Smart API Gateway (Proxy Layer) listening on http://${this.config.host}:${this.config.port}`);
        resolve();
      });
      
      this.server.on('error', (err: any) => reject(err));
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.log.info('API Gateway stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

