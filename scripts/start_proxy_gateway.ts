import { ProxyPoolService, FOFASource, ProxiflyCDNSource, LocalFileSource } from '../electron/services/ProxyPoolService';
import { ProxyGateway } from '../electron/services/proxy/ProxyGateway';
import { Logger } from '../electron/utils/Logger';

const logger = Logger.create('GhostFleetBoot');

async function bootGhostFleet() {
  logger.info('Initializing Ghost Fleet (Dynamic Proxy Pool Infrastructure)...');

  // 配置代理池
  const poolService = new ProxyPoolService({
    strategy: 'quality', // 按质量与延迟分配节点
    healthCheckIntervalMs: 60000, // 高频健康度轮询
    autoPurge: true
  });

  // 挂载数据源
  poolService.addSource(new ProxiflyCDNSource()); // The default comprehensive public scrapers
  
  // 加上我们之前的本地跑通的高分 SOCKS5 池子
  poolService.addSource(new LocalFileSource('data/verified_proxies.txt', 'socks5'));

  // 启动代理池开始全网捕获节点和质量测试
  poolService.start();

  // 启动无感动态轮替出口网关
  const gateway = new ProxyGateway(poolService, 50000);
  gateway.start();

  // 初次采集
  logger.info('Executing initial raw node harvesting...');
  await poolService.fetchAllSources();
  await poolService.healthCheckAll();

  logger.info('Ghost Fleet Boot Sequence Complete. Ready to spoof signatures natively.');
}

bootGhostFleet();
