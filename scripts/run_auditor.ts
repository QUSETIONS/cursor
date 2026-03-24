import { RelayStationAuditor } from './RelayStationAuditor';

async function main() {
  console.log('--- 启动中转站逆向渗透与安全审计测试 ---');
  console.log('目标靶机: http://127.0.0.1:3000 (本地模拟脆弱中转站)');
  
  const auditor = new RelayStationAuditor('http://127.0.0.1:3000');
  const report = await auditor.runAudit();
  
  console.log('\n=== 渗透测试结果与安全审计报告 ===');
  console.log(JSON.stringify(report, null, 2));
}

main().catch(console.error);
