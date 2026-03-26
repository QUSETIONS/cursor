import axios from 'axios';
import { Logger } from '../utils/Logger';

/**
 * 通用接码平台服务 (以 SMS-Activate API 为例)
 * 用于应对 OpenAI、Claude 等需要实体手机号验证的防自动化保护机制。
 */
export class SmsService {
  private apiKey: string;
  private baseUrl = 'https://api.sms-activate.org/stubs/handler_api.php';
  private logger = Logger.create('SmsService');

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    if (!this.apiKey) {
      this.logger.warn('SmsActivate API Key 未配置。短信接码功能将不可用！');
    }
  }

  /**
   * 获取账号余额
   */
  public async getBalance(): Promise<number> {
    const res = await axios.get(this.baseUrl, {
      params: { api_key: this.apiKey, action: 'getBalance' }
    });
    
    if (res.data.includes('ACCESS_BALANCE')) {
      const balance = parseFloat(res.data.split(':')[1]);
      return balance;
    }
    throw new Error(`获取余额失败: ${res.data}`);
  }

  /**
   * 申请手机号码
   * @param service 目标平台简码 (如: OpenAI="or", Claude(Anthropic)="ot", Gemini/Google="go")
   * @param country 国家代码 (如: 0=俄罗斯, 1=乌克兰, 187=美国, 可留空取最快)
   */
  public async getNumber(service: string, country?: number): Promise<{ id: string; phone: string }> {
    this.logger.info(`正在请求 ${service} 专属手机号...`);
    const params: any = {
      api_key: this.apiKey,
      action: 'getNumber',
      service,
      forward: 0
    };
    if (country !== undefined) params.country = country;

    const res = await axios.get(this.baseUrl, { params });
    if (res.data.startsWith('ACCESS_NUMBER')) {
      const parts = res.data.split(':');
      this.logger.info(`获取号码成功: +${parts[2]} (订单ID: ${parts[1]})`);
      return { id: parts[1], phone: parts[2] };
    }
    throw new Error(`获取号码失败: ${res.data}`);
  }

  /**
   * 改变订单状态
   * status=1: 告知系统验证码已发送
   * status=3: 申请换号（号码报错或未发送）
   * status=6: 完成交易
   * status=8: 拉黑当前号码（收不到验证码）
   */
  public async setStatus(id: string, status: number): Promise<boolean> {
    const res = await axios.get(this.baseUrl, {
      params: { api_key: this.apiKey, action: 'setStatus', id, status }
    });
    return res.data.includes('ACCESS');
  }

  /**
   * 阻塞式循环拉取短信验证码
   * @param id 订单 ID
   * @param timeoutSeconds 最大等待时间 (默认 300 秒)
   */
  public async waitForCode(id: string, timeoutSeconds: number = 300): Promise<string | null> {
    const startTime = Date.now();
    this.logger.info(`开始轮询短信验证码 (订单: ${id}), 限时 ${timeoutSeconds}s...`);

    // 刚拿到的号码通常需要几秒钟后台同步状态，可以直接设置为已发送(status=1)
    await this.setStatus(id, 1).catch(() => {});

    while (Date.now() - startTime < timeoutSeconds * 1000) {
      const res = await axios.get(this.baseUrl, {
        params: { api_key: this.apiKey, action: 'getStatus', id }
      });

      if (res.data.startsWith('STATUS_OK')) {
        const code = res.data.split(':')[1];
        this.logger.info(`余额获取成功: ${res.data}`);
        return code;
      }
      
      if (res.data === 'STATUS_CANCEL') {
        this.logger.warn(`❌ 订单 ${id} 已被取消`);
        return null;
      }

      // 等待 5 秒后再次轮询
      await new Promise(r => setTimeout(r, 5000));
    }

    this.logger.warn(`⏳ 等待验证码超时，将拉黑此号码以退还额度...`);
    await this.setStatus(id, 8).catch(() => {});
    return null;
  }
}
