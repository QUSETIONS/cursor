import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';

async function testWarpProxy() {
  const proxyPort = 9001;
  console.log(`[IPv6 测试] 正在通过 WARP SOCKS5 节点 (127.0.0.1:${proxyPort}) 访问 IP 拨测接口...`);
  
  const agent = new SocksProxyAgent(`socks5://127.0.0.1:${proxyPort}`);
  try {
    const res = await axios.get('https://api64.ipify.org?format=json', {
      httpsAgent: agent,
      timeout: 10000
    });
    console.log(`✅ [测试成功] 当前探测到的出口 IP 是: ${res.data.ip}`);
    if (res.data.ip.includes(':')) {
      console.log(`✅ [判定] 这是一个标准的 IPv6 地址！网络隔离与 IP 伪装非常完美，注册机将使用它来绕过风控。`);
    } else {
      console.log(`⚠️ [判定] 这是一个 IPv4 地址，请检查你的 WARP 路由。`);
    }
  } catch (err) {
    console.error(`❌ [测试失败] Proxy连接超时或中断:`, err.message);
  }
}

testWarpProxy();
