import http from 'node:http';
import net from 'node:net';
import { URL } from 'node:url';
import { SocksClient } from 'socks';
import { Logger } from '../../utils/Logger';
import { ProxyPoolService, ProxyEntry } from '../ProxyPoolService';

/**
 * 幽灵舰队网关 (The Ghost Fleet Gateway)
 * 在本地开启一个 HTTP 代理端口 (默认 50000)，实现自动化、无感的动态 IP 轮换发包。
 */
export class ProxyGateway {
  private logger = Logger.create('ProxyGateway');
  private server: http.Server;

  constructor(private poolService: ProxyPoolService, private port: number = 50000) {
    this.server = http.createServer();

    // 处理普通的 HTTP 代理请求
    this.server.on('request', (req, res) => this.handleHttpRequest(req, res));
    
    // 处理 HTTPS (CONNECT) 隧道请求
    this.server.on('connect', (req, clientSocket, head) => this.handleConnectRequest(req, clientSocket, head));
  }

  public start() {
    this.server.listen(this.port, '127.0.0.1', () => {
      this.logger.info(`👻 Ghost Fleet Gateway is running on http://127.0.0.1:${this.port}`);
      this.logger.info(`将浏览器的 HTTP 代理设置为该地址，即可享受无感动态高质量 IP 轮换`);
    });
  }

  public stop() {
    this.server.close();
    this.logger.info('Ghost Fleet Gateway stopped.');
  }

  /**
   * 选择一个最优的出口节点（跳过已知死亡的 WARP 节点）
   */
  private getUpstreamProxy(): ProxyEntry | null {
    // Use a unique taskId per request to avoid sticky session conflicts
    const taskId = `gw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let proxy = this.poolService.leaseProxy(taskId);
    if (!proxy) proxy = this.poolService.getNext();
    return proxy;
  }

  private releaseUpstream(proxy: ProxyEntry, success: boolean, reason?: string) {
    // Find and release the lease by matching the proxy
    // Since we use unique taskIds, just report success/failure directly
    if (success) {
      this.poolService.reportSuccess(proxy.id);
    } else {
      this.poolService.reportFailure(proxy.id);
    }
  }

  /**
   * 处理 HTTP (非加密) 代理路由
   */
  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const upstream = this.getUpstreamProxy();
    if (!upstream) {
      res.writeHead(502);
      res.end('No available proxies in The Ghost Fleet');
      return;
    }

    try {
      const parsedUrl = new URL(req.url!);
      const options: http.RequestOptions = {
        hostname: upstream.host,
        port: upstream.port,
        path: req.url,
        method: req.method,
        headers: req.headers
      };

      this.logger.info(`[HTTP] ${req.method} ${parsedUrl.hostname} -> Routed via ${upstream.host}:${upstream.port} (Score: ${upstream.qualityScore})`);

      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });

      proxyReq.on('error', (e) => {
        this.logger.error(`[HTTP] Upstream Error (${upstream.host}): ${e.message}`);
        this.poolService.reportFailure(upstream.id);
        res.writeHead(502);
        res.end('Upstream Connection Error');
      });

      req.pipe(proxyReq, { end: true });
    } catch (e: any) {
      res.writeHead(400);
      res.end('Bad Request URL');
    }
  }

  /**
   * 处理 HTTPS (CONNECT) 隧道联通
   * 这是现代浏览器中最主要的代理方式 (用于加密流量)
   */
  private async handleConnectRequest(req: http.IncomingMessage, clientSocket: any, head: Buffer) {
    // Prevent ECONNRESET crash when client disconnects mid-tunnel
    clientSocket.on('error', (e: any) => {
      this.logger.warn(`[CONNECT] Client socket error: ${e.message}`);
    });

    const portUrl = new URL(`http://${req.url}`);
    const destHost = portUrl.hostname;
    const destPort = portUrl.port ? parseInt(portUrl.port) : 443;

    const MAX_RETRIES = 3;
    const SOCKS5_TIMEOUT_MS = 8000;
    const triedIds = new Set<string>();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const upstream = this.getUpstreamProxy();
      if (!upstream || triedIds.has(upstream.id)) {
        // If we already tried this proxy or no proxy available, try getNext directly
        const fallback = this.poolService.getNext();
        if (!fallback || triedIds.has(fallback.id)) {
          this.logger.error(`[CONNECT] All proxies exhausted after ${attempt - 1} attempts for ${destHost}`);
          clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\nAll proxies exhausted');
          clientSocket.end();
          return;
        }
        triedIds.add(fallback.id);
        try {
          await this.attemptConnect(fallback, destHost, destPort, clientSocket, head, SOCKS5_TIMEOUT_MS);
          this.releaseUpstream(fallback, true);
          return; // success
        } catch (err: any) {
          this.logger.warn(`[CONNECT] Attempt ${attempt}/${MAX_RETRIES} failed via ${fallback.host}:${fallback.port}: ${err.message}`);
          this.releaseUpstream(fallback, false, err.message);
          continue;
        }
      }

      triedIds.add(upstream.id);
      this.logger.info(`[HTTPS] CONNECT ${destHost}:${destPort} -> Attempt ${attempt}/${MAX_RETRIES} via ${upstream.protocol}://${upstream.host}:${upstream.port} (Score: ${upstream.qualityScore})`);

      try {
        await this.attemptConnect(upstream, destHost, destPort, clientSocket, head, SOCKS5_TIMEOUT_MS);
        this.releaseUpstream(upstream, true);
        return; // success
      } catch (err: any) {
        this.logger.warn(`[CONNECT] Attempt ${attempt}/${MAX_RETRIES} failed via ${upstream.host}:${upstream.port}: ${err.message}`);
        this.releaseUpstream(upstream, false, err.message);
        continue;
      }
    }

    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\nAll retry attempts failed');
    clientSocket.end();
  }

  /**
   * Attempt a single CONNECT tunnel through one upstream proxy.
   * Returns a promise that resolves on success or rejects on failure/timeout.
   */
  private attemptConnect(
    upstream: ProxyEntry, destHost: string, destPort: number,
    clientSocket: any, head: Buffer, timeoutMs: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (upstream.protocol === 'socks5') {
        const timer = setTimeout(() => {
          reject(new Error(`SOCKS5 connection timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        SocksClient.createConnection({
          proxy: { host: upstream.host, port: upstream.port, type: 5 },
          command: 'connect',
          destination: { host: destHost, port: destPort },
          timeout: timeoutMs
        }).then((info) => {
          clearTimeout(timer);
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          info.socket.write(head);
          info.socket.pipe(clientSocket);
          clientSocket.pipe(info.socket);
          info.socket.on('error', (e) => {
            this.logger.error(`[SOCKS5] Upstream Error (${upstream.host}): ${e.message}`);
            this.poolService.reportFailure(upstream.id);
            clientSocket.end();
          });
          resolve();
        }).catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
      } else {
        // Raw HTTP CONNECT tunnel
        const upstreamSocket = net.connect(upstream.port, upstream.host, () => {
          upstreamSocket.write(`CONNECT ${destHost}:${destPort} HTTP/1.1\r\nHost: ${destHost}:${destPort}\r\n\r\n`);
        });

        const timer = setTimeout(() => {
          upstreamSocket.destroy();
          reject(new Error(`HTTP CONNECT timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        let connected = false;
        upstreamSocket.on('data', (chunk) => {
          if (!connected) {
            clearTimeout(timer);
            const resp = chunk.toString();
            if (resp.includes('200')) {
              connected = true;
              clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
              clientSocket.write(head);
              upstreamSocket.pipe(clientSocket);
              clientSocket.pipe(upstreamSocket);
              resolve();
            } else {
              reject(new Error(`Upstream rejected: ${resp.substring(0, 60)}`));
            }
          }
        });

        upstreamSocket.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
      }
    });
  }
}
