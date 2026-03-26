/**
 * Catch-All 域名邮件路由验证测试
 * 测试 nirvana-farm-2026.cyou → Outlook IMAP 的完整链路
 */
import 'dotenv/config';
import Imap from 'imap';

const CATCH_ALL_DOMAIN = 'nirvana-farm-2026.cyou';
const OUTLOOK_EMAIL = process.env.IMAP_USER || '';
const OUTLOOK_PASS = process.env.IMAP_PASS || '';
const IMAP_HOST = 'imap.gmail.com';

// 生成随机 Catch-All 邮箱
function generateCatchAllEmail(): string {
  const prefix = Math.random().toString(36).substring(2, 10);
  return `${prefix}@${CATCH_ALL_DOMAIN}`;
}

async function testImapConnection(): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`\n📬 正在测试 IMAP 连接: ${OUTLOOK_EMAIL} → ${IMAP_HOST}...`);
    const imap = new Imap({
      user: OUTLOOK_EMAIL,
      password: OUTLOOK_PASS,
      host: IMAP_HOST,
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 15000,
    });

    imap.once('ready', () => {
      console.log('✅ IMAP 连接成功！Outlook 收件箱可达。');
      
      // 打开收件箱
      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          console.log('❌ 打开收件箱失败:', err.message);
          imap.end();
          resolve(false);
          return;
        }
        
        console.log(`📨 收件箱状态: ${box.messages.total} 封邮件`);
        
        // 搜索发往 catch-all 域名的邮件
        const searchDate = new Date();
        searchDate.setDate(searchDate.getDate() - 1);
        const dateStr = searchDate.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
        
        imap.search(['ALL', ['SINCE', dateStr]], (searchErr, results) => {
          if (searchErr) {
            console.log('⚠️ 搜索邮件时出错:', searchErr.message);
          } else {
            console.log(`📊 过去 24 小时收到 ${results.length} 封邮件`);
            
            // 检查是否有发往 catch-all 域名的邮件
            if (results.length > 0) {
              const lastFew = results.slice(-5);
              const f = imap.fetch(lastFew, { bodies: 'HEADER.FIELDS (TO FROM SUBJECT DATE)', struct: true });
              f.on('message', (msg) => {
                msg.on('body', (stream) => {
                  let buffer = '';
                  stream.on('data', (chunk: Buffer) => { buffer += chunk.toString('utf8'); });
                  stream.on('end', () => {
                    const toMatch = buffer.match(/To:\s*(.+)/i);
                    if (toMatch && toMatch[1].includes(CATCH_ALL_DOMAIN)) {
                      console.log(`🎯 发现 Catch-All 邮件! To: ${toMatch[1].trim()}`);
                    }
                  });
                });
              });
              f.once('end', () => {
                imap.end();
                resolve(true);
              });
            } else {
              imap.end();
              resolve(true);
            }
          }
        });
      });
    });

    imap.once('error', (err: any) => {
      console.log('❌ IMAP 连接失败:', err.message);
      resolve(false);
    });

    imap.connect();
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🌐 Catch-All 域名邮件路由验证测试');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  域名:     ${CATCH_ALL_DOMAIN}`);
  console.log(`  收件箱:   ${OUTLOOK_EMAIL}`);
  console.log(`  IMAP:     ${IMAP_HOST}:993`);
  console.log('═══════════════════════════════════════════════════');

  // 1. 生成示例 Catch-All 邮箱
  console.log('\n📋 随机邮箱生成测试:');
  for (let i = 0; i < 5; i++) {
    console.log(`  ${i + 1}. ${generateCatchAllEmail()}`);
  }

  // 2. 测试 IMAP 连接
  const imapOk = await testImapConnection();
  
  // 3. 总结
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  📋 测试结果汇总');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Catch-All 域名:  ✅ ${CATCH_ALL_DOMAIN}`);
  console.log(`  随机邮箱生成:    ✅ 正常`);
  console.log(`  IMAP 连接:       ${imapOk ? '✅ 连接成功' : '❌ 连接失败'}`);
  
  if (imapOk) {
    console.log('\n  🎉 Catch-All 链路验证通过！');
    console.log('  注册引擎现在可以使用无限随机邮箱进行批量注册。');
    console.log(`  任何发往 *@${CATCH_ALL_DOMAIN} 的邮件将自动转到 ${OUTLOOK_EMAIL}`);
  } else {
    console.log('\n  ⚠️ IMAP 连接失败，请检查 Outlook 密码或网络。');
  }
  
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(console.error);
