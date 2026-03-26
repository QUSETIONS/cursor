/**
 * SubscriptionProxySource — 机场订阅 URL → 代理节点解析引擎
 * 
 * 支持的订阅格式:
 * - Base64 编码的标准订阅（V2RayN / Clash 通用格式）
 * - 每行一个 URI（vmess://, trojan://, ss://, vless://, ssr://）
 * 
 * 解析后的节点可直接注入 ProxyPoolService，参与质量评分和 Ghost Fleet 路由。
 */

import net from 'node:net';
import { Logger } from '../../utils/Logger';
import type { ProxySource } from '../ProxyPoolService';

const log = Logger.create('SubscriptionSource');

export interface SubscriptionConfig {
  /** 订阅 URL（支持 Base64 编码） */
  url: string;
  /** 可读名称 */
  name?: string;
  /** 刷新间隔 (ms)，默认 30 分钟 */
  refreshIntervalMs?: number;
}

interface ParsedNode {
  protocol: 'http' | 'socks5';
  host: string;
  port: number;
  /** 原始协议类型（vmess/trojan/ss/vless） */
  originalProto: string;
  remark?: string;
}

/**
 * 实现 ProxySource 接口的订阅源
 * 可直接通过 poolService.addSource(new SubscriptionProxySource(config)) 挂载
 */
export class SubscriptionProxySource implements ProxySource {
  name: string;
  fetchIntervalMs: number;
  private config: SubscriptionConfig;

  constructor(config: SubscriptionConfig) {
    this.config = config;
    this.name = `sub:${config.name || 'unnamed'}`;
    this.fetchIntervalMs = config.refreshIntervalMs ?? 1_800_000; // 30 min
  }

  async fetch(): Promise<string[]> {
    log.info(`[${this.name}] 正在拉取订阅...`);

    try {
      const res = await globalThis.fetch(this.config.url, {
        headers: { 'User-Agent': 'ClashForWindows/0.20.39' },
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        log.warn(`[${this.name}] HTTP ${res.status}`);
        return [];
      }

      const rawText = await res.text();
      let nodes: ParsedNode[];

      // 自动检测格式: Clash YAML vs Base64 V2Ray
      if (rawText.includes('proxies:') && (rawText.includes('type: ss') || rawText.includes('type: vmess') || rawText.includes('type: trojan'))) {
        // Clash YAML 格式
        log.info(`[${this.name}] 检测到 Clash YAML 格式`);
        nodes = parseClashYaml(rawText);
      } else {
        // Base64 / V2Ray URI 格式
        const decoded = tryBase64Decode(rawText.trim());
        const lines = decoded.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        log.info(`[${this.name}] 解析到 ${lines.length} 行原始数据`);
        nodes = parseSubscriptionLines(lines);
      }

      log.info(`[${this.name}] 成功解析 ${nodes.length} 个节点`);

      // 快速 TCP 连通性测试
      const alive = await batchTcpCheck(nodes, 60, 4000);
      log.info(`[${this.name}] TCP 存活: ${alive.length}/${nodes.length}`);

      // 转换为 ProxyPoolService 可用的 URI 格式
      return alive.map(n => `${n.protocol}://${n.host}:${n.port}`);
    } catch (err: any) {
      log.error(`[${this.name}] 拉取失败: ${err.message}`);
      return [];
    }
  }
}

// ─── 协议解析器 ───

/**
 * 解析 Clash YAML 格式的 proxies 节
 * 无需完整 YAML 库，用正则直接提取 server/port/type/name
 */
function parseClashYaml(yaml: string): ParsedNode[] {
  const nodes: ParsedNode[] = [];

  // 匹配 proxies: 区块中的每个 {name: ..., server: ..., port: ..., type: ...}
  const proxyBlockMatch = yaml.match(/proxies:\s*\n([\s\S]*?)(?:\nproxy-groups:|\nrules:|$)/);
  if (!proxyBlockMatch) return nodes;

  const proxyBlock = proxyBlockMatch[1];
  // 每行 "  - {name: ..., server: ..., port: ..., type: ...}"
  const lineRegex = /^\s*-\s*\{(.+?)\}\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = lineRegex.exec(proxyBlock)) !== null) {
    try {
      const content = match[1];

      // 提取关键字段
      const serverMatch = content.match(/server:\s*([^,}]+)/);
      const portMatch = content.match(/port:\s*(\d+)/);
      const typeMatch = content.match(/type:\s*(\w+)/);
      const nameMatch = content.match(/name:\s*([^,}]+)/);

      if (!serverMatch || !portMatch || !typeMatch) continue;

      const server = serverMatch[1].trim();
      const port = parseInt(portMatch[1], 10);
      const type = typeMatch[1].trim().toLowerCase();
      const name = nameMatch?.[1]?.trim() || '';

      if (!server || isNaN(port)) continue;

      // 跳过下载专用节点 (倍率极低，不适合注册)
      if (name.includes('下载专用') || name.includes('x0.01')) continue;

      nodes.push({
        protocol: 'socks5',  // 实际上这些是 ss/vmess，但我们只需要 host:port 用来做 TCP check
        host: server,
        port,
        originalProto: type,
        remark: name,
      });
    } catch {
      // 单行解析失败不影响整体
    }
  }

  return nodes;
}

function parseSubscriptionLines(lines: string[]): ParsedNode[] {
  const nodes: ParsedNode[] = [];

  for (const line of lines) {
    try {
      if (line.startsWith('vmess://')) {
        const node = parseVmess(line);
        if (node) nodes.push(node);
      } else if (line.startsWith('trojan://')) {
        const node = parseTrojan(line);
        if (node) nodes.push(node);
      } else if (line.startsWith('ss://')) {
        const node = parseShadowsocks(line);
        if (node) nodes.push(node);
      } else if (line.startsWith('vless://')) {
        const node = parseVless(line);
        if (node) nodes.push(node);
      } else if (line.startsWith('ssr://')) {
        const node = parseSSR(line);
        if (node) nodes.push(node);
      }
      // 其他未知格式跳过
    } catch {
      // 单行解析失败不影响整体
    }
  }

  return nodes;
}

/** vmess://BASE64JSON */
function parseVmess(uri: string): ParsedNode | null {
  const b64 = uri.slice('vmess://'.length);
  const json = tryBase64Decode(b64);
  try {
    const obj = JSON.parse(json);
    const host = obj.add || obj.host;
    const port = parseInt(String(obj.port), 10);
    if (!host || !port || isNaN(port)) return null;
    return { protocol: 'socks5', host, port, originalProto: 'vmess', remark: obj.ps || obj.remark };
  } catch {
    return null;
  }
}

/** trojan://password@host:port?... */
function parseTrojan(uri: string): ParsedNode | null {
  try {
    const url = new URL(uri);
    const host = url.hostname;
    const port = parseInt(url.port, 10) || 443;
    if (!host) return null;
    return { protocol: 'socks5', host, port, originalProto: 'trojan', remark: decodeURIComponent(url.hash.slice(1) || '') };
  } catch {
    return null;
  }
}

/** ss://BASE64(method:password)@host:port#remark */
function parseShadowsocks(uri: string): ParsedNode | null {
  try {
    // ss:// 有两种格式：
    // 1. ss://BASE64(method:password@host:port)#remark
    // 2. ss://BASE64(method:password)@host:port#remark
    let cleaned = uri.slice('ss://'.length);
    const hashIdx = cleaned.indexOf('#');
    const remark = hashIdx > 0 ? decodeURIComponent(cleaned.slice(hashIdx + 1)) : '';
    if (hashIdx > 0) cleaned = cleaned.slice(0, hashIdx);

    // Try format 2 first (most common in modern subscriptions)
    const atIdx = cleaned.lastIndexOf('@');
    if (atIdx > 0) {
      const hostPort = cleaned.slice(atIdx + 1);
      const [host, portStr] = hostPort.split(':');
      const port = parseInt(portStr, 10);
      if (host && port && !isNaN(port)) {
        return { protocol: 'socks5', host, port, originalProto: 'ss', remark };
      }
    }

    // Try format 1: entire thing is base64
    const decoded = tryBase64Decode(cleaned);
    const match = decoded.match(/@([^:]+):(\d+)/);
    if (match) {
      return { protocol: 'socks5', host: match[1], port: parseInt(match[2], 10), originalProto: 'ss', remark };
    }
    return null;
  } catch {
    return null;
  }
}

/** vless://uuid@host:port?... */
function parseVless(uri: string): ParsedNode | null {
  try {
    const url = new URL(uri);
    const host = url.hostname;
    const port = parseInt(url.port, 10) || 443;
    if (!host) return null;
    return { protocol: 'socks5', host, port, originalProto: 'vless', remark: decodeURIComponent(url.hash.slice(1) || '') };
  } catch {
    return null;
  }
}

/** ssr://BASE64(...) */
function parseSSR(uri: string): ParsedNode | null {
  try {
    const b64 = uri.slice('ssr://'.length);
    const decoded = tryBase64Decode(b64);
    // Format: host:port:protocol:method:obfs:password_base64/?params
    const parts = decoded.split(':');
    if (parts.length >= 2) {
      const host = parts[0];
      const port = parseInt(parts[1], 10);
      if (host && port && !isNaN(port)) {
        return { protocol: 'socks5', host, port, originalProto: 'ssr' };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Utilities ───

function tryBase64Decode(str: string): string {
  try {
    // Handle URL-safe Base64
    const standard = str.replace(/-/g, '+').replace(/_/g, '/');
    // Pad to multiple of 4
    const padded = standard + '='.repeat((4 - standard.length % 4) % 4);
    return Buffer.from(padded, 'base64').toString('utf-8');
  } catch {
    return str; // fallback: treat as plain text
  }
}

/** 并发 TCP 连通性测试 */
async function batchTcpCheck(nodes: ParsedNode[], concurrency: number, timeout: number): Promise<ParsedNode[]> {
  const alive: ParsedNode[] = [];

  for (let i = 0; i < nodes.length; i += concurrency) {
    const batch = nodes.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(node => tcpCheck(node, timeout)));
    for (const r of results) {
      if (r) alive.push(r);
    }
  }

  return alive;
}

function tcpCheck(node: ParsedNode, timeout: number): Promise<ParsedNode | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: node.host, port: node.port, timeout }, () => {
      socket.destroy();
      resolve(node);
    });
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
    socket.on('error', () => { socket.destroy(); resolve(null); });
  });
}

// ─── 便捷工厂函数 ───

/**
 * 从多个订阅链接创建代理源数组
 * 用法: const sources = createSubscriptionSources([
 *   { url: 'https://xxx.com/sub', name: 'Airport-1' },
 *   { url: 'https://yyy.com/sub', name: 'Airport-2' },
 * ]);
 * sources.forEach(s => poolService.addSource(s));
 */
export function createSubscriptionSources(configs: SubscriptionConfig[]): SubscriptionProxySource[] {
  return configs.map(c => new SubscriptionProxySource(c));
}
