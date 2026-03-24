import { TokenRefreshService } from './electron/services/TokenRefreshService';
import { ApiGateway } from './electron/services/ApiGateway';

async function main() {
  console.log('--- Initializing ApiGateway Load Test Environment ---');
  const tokenService = new TokenRefreshService();
  const gateway = new ApiGateway(tokenService, { port: 18085 });

  await gateway.start();
  console.log('Gateway is listening on port 18085');

  // Inject a dummy token explicitly for test parsing
  tokenService.addToken({
      id: 'test-1', platform: 'cursor', email: 'test@cursor.com',
      accessToken: 'dummy-cursor-token', isValid: true, failCount: 0
  });

  const concurrency = 15;
  const endpoint = 'http://127.0.0.1:18085/v1/chat/completions';
  const payload = {
    model: 'cursor-proxy',
    messages: [
      { role: 'user', content: 'Say "Load test success!"' }
    ],
    stream: true
  };

  const startTime = Date.now();
  const tasks = Array.from({ length: concurrency }).map(async (_, idx) => {
    const reqStart = Date.now();
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer 123' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      return { success: true, dt: Date.now() - reqStart, size: text.length };
    } catch (err: any) {
      return { success: false, err: err.message };
    }
  });

  const results = await Promise.all(tasks);
  const successes = results.filter(r => r.success).length;

  console.log(`\n=== Load Test Complete ===`);
  console.log(`Wall time: ${Date.now() - startTime}ms`);
  console.log(`Throughput: ${successes}/${concurrency} successful streams`);

  if (successes < concurrency) {
      console.log('First error:', results.find(r => !r.success));
  } else {
      console.log('All concurrent proxy translations passed gracefully!');
  }

  await gateway.stop();
  process.exit(0);
}

main().catch(console.error);
