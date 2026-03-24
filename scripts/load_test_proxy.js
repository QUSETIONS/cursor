import fs from 'node:fs';

async function runLoadTest(concurrency = 15) {
  console.log(`Starting API Gateway Load Test (Concurrent: ${concurrency})...`);
  
  const endpoint = 'http://127.0.0.1:18080/v1/chat/completions';
  const payload = {
    model: 'cursor-proxy',
    messages: [
      { role: 'system', content: 'You are a highly capable coding assistant.' },
      { role: 'user', content: 'In one short sentence, describe what React is.' }
    ],
    stream: true
  };

  const startTime = Date.now();
  
  const tasks = Array.from({ length: concurrency }).map(async (_, idx) => {
    const reqStart = Date.now();
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Pass the dummy key expected by gateway if needed (not checked strictly for internal usage usually)
          'Authorization': 'Bearer dummy-load-test'
        },
        body: JSON.stringify(payload)
      });
      
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} - ${resp.statusText}`);
      }
      
      // Consume the SSE stream
      const text = await resp.text();
      const size = text.length;
      const dt = Date.now() - reqStart;
      fs.writeFileSync('output.log', `[Req ${idx+1}] Success: Received ${size} bytes streamed. (${dt}ms)`);
      return { success: true, dt, size };
    } catch(err) {
      const dt = Date.now() - reqStart;
      fs.writeFileSync('output.log', `[Req ${idx+1}] Failed: ${err.message} (${dt}ms)`);
      return { success: false, dt, err: err.message };
    }
  });

  const results = await Promise.all(tasks);
  
  const totalDt = Date.now() - startTime;
  const successes = results.filter(r => r.success).length;
  
  fs.writeFileSync('load_test_results.txt', JSON.stringify({ 
      concurrency, successes, 
      firstError: results.find(r => !r.success) 
  }, null, 2));

  console.log(`\n=== Load Test Complete ===`);
  console.log(`Elapsed wall time: ${totalDt}ms`);
  console.log(`Success Rate: ${successes} / ${concurrency}`);
  
  // Exit non-zero if there were failures
  if (successes < concurrency) process.exit(1);
}

runLoadTest().catch(err => fs.writeFileSync('CRASH.txt', typeof err === 'object' ? String(err.stack) : String(err)));
