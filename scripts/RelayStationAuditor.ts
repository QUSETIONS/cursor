/**
 * RelayStationAuditor
 * 
 * 这是一个用于本地研究和优化系统安全性的防御性安全审计工具。
 * 它可以扫描基于 One-API / New-API 等开源框架搭建的中转站网关，
 * 测试其是否存在常见的安全隐患，从而帮助完善我们自建网关的防御体系。
 * 
 * 免责声明：仅限用于已授权的本地/内部网关节点的安全测试。
 */

import axios from 'axios';

export interface AuditReport {
  targetUrl: string;
  defaultCredentialsVulnerable: boolean;
  channelLeakageVulnerable: boolean;
  unauthorizedApiAccess: boolean;
  warnings: string[];
}

export class RelayStationAuditor {
  private targetUrl: string;

  constructor(targetUrl: string) {
    // 移除末尾的斜杠
    this.targetUrl = targetUrl.replace(/\/$/, '');
  }

  /**
   * 运行全面安全审计
   */
  public async runAudit(): Promise<AuditReport> {
    console.log(`[Auditor] 开始对中转站网关进行安全扫描: ${this.targetUrl}`);
    
    const report: AuditReport = {
      targetUrl: this.targetUrl,
      defaultCredentialsVulnerable: false,
      channelLeakageVulnerable: false,
      unauthorizedApiAccess: false,
      warnings: []
    };

    await this.testDefaultCredentials(report);
    await this.testChannelLeakage(report);
    await this.testUnauthorizedAccess(report);

    return report;
  }

  /**
   * 测试 1: 弱口令 / 默认管理员密码漏洞 (Default Credentials)
   * 检查是否使用了 One-API 默认的 root:123456
   */
  private async testDefaultCredentials(report: AuditReport): Promise<void> {
    console.log(`[Auditor] 正在检测默认管理员密码...`);
    try {
      const response = await axios.post(`${this.targetUrl}/api/user/login`, {
        username: 'root',
        password: '123456'
      }, { validateStatus: () => true });

      if (response.status === 200 && response.data && response.data.success) {
        report.defaultCredentialsVulnerable = true;
        report.warnings.push('严重漏洞: 发现默认的 root:123456 管理员密码，攻击者可直接接管系统并导出所有上游 Key。');
      }
    } catch (e) {
      console.log(`[Auditor] 登录接口测试失败: ${e}`);
    }
  }

  /**
   * 测试 2: 上游渠道信息泄露 (Channel Leakage)
   * 通过发送畸形参数（如无效金额、超大 tokens）诱发上游报错，检查中转站是否直接透传了真实的上游报错信息。
   */
  private async testChannelLeakage(report: AuditReport): Promise<void> {
    console.log(`[Auditor] 正在检测异常处理与真实渠道泄露风险...`);
    try {
      // 构造一个故意触发上游异常的恶意请求 (例如传入不存在的模型或超大的 tokens)
      const fakeToken = 'sk-audit-fake-token-12345';
      const response = await axios.post(`${this.targetUrl}/v1/chat/completions`, {
        model: 'gpt-4-0613',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 99999999 // 故意超限
      }, {
        headers: {
          'Authorization': `Bearer ${fakeToken}`,
          'Content-Type': 'application/json'
        },
        validateStatus: () => true
      });

      const responseBody = JSON.stringify(response.data || {}).toLowerCase();
      // 寻找泄露特征：包含了 openai 的真实 url、或者特殊的 key 格式
      if (responseBody.includes('upstream') || responseBody.includes('api.openai.com') || /sk-[a-zA-Z0-9]{32,}/.test(responseBody)) {
        report.channelLeakageVulnerable = true;
        report.warnings.push('中危风险: 错误信息直接透传。系统未能有效包装异常，可能向外泄露真实的 Upstream API URL 或原始的 API Key 信息。');
      }
    } catch (e) {
      console.log(`[Auditor] 渠道泄露测试请求失败: ${e}`);
    }
  }

  /**
   * 测试 3: 未授权 API 访问 (BOLA / Broken Object Level Authorization)
   * 尝试在无权限状态下访问渠道列表等敏感接口。
   */
  private async testUnauthorizedAccess(report: AuditReport): Promise<void> {
    console.log(`[Auditor] 正在检测敏感接口未授权访问越权...`);
    try {
      const endpoints = ['/api/channel/', '/api/user/', '/api/token/'];
      for (const endpoint of endpoints) {
        const response = await axios.get(`${this.targetUrl}${endpoint}`, { validateStatus: () => true });
        
        // 如果返回了非 401/403 的成功数据（通常是列表），说明存在越权
        if (response.status === 200 && response.data && response.data.data && Array.isArray(response.data.data)) {
          report.unauthorizedApiAccess = true;
          report.warnings.push(`严重漏洞: 未授权直接访问了敏感端点 ${endpoint}，导致核心数据暴露。`);
          break;
        }
      }
    } catch (e) {
      console.log(`[Auditor] 接口越权测试失败: ${e}`);
    }
  }
}

// =========================================
// 使用示例 (供本地研究和加固自身网关使用)：
// =========================================
/*
async function testMyGateway() {
  // 假设本地起了一个 One-API / 自建中转服务
  const auditor = new RelayStationAuditor('http://127.0.0.1:3000');
  const report = await auditor.runAudit();
  console.log('\n=== 安全审计报告 ===');
  console.log(JSON.stringify(report, null, 2));
}
testMyGateway();
*/
