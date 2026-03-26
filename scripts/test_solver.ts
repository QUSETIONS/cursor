import axios from 'axios';

async function testSolver() {
  console.log('Sending request to Nirvana Solver API (http://localhost:8191/v1)...');
  const startTime = Date.now();
  
  try {
    const res = await axios.post('http://localhost:8191/v1', {
      cmd: 'request.get',
      url: 'https://authenticator.cursor.sh/sign-up',
      maxTimeout: 45000
    });
    
    console.log('\n✅ Solver API Response received in ' + ((Date.now() - startTime)/1000).toFixed(1) + 's');
    console.log(JSON.stringify(res.data, null, 2));
    
    if (res.data.solution?.token) {
      console.log('\n🎉 SUCCESS! Extracted Turnstile Token natively:');
      console.log(res.data.solution.token);
    } else {
      console.log('\n⚠️ No token found in solution.');
    }
  } catch (e: any) {
    console.error('\n❌ Solver API Request Failed:');
    if (e.response) {
      console.error(JSON.stringify(e.response.data, null, 2));
    } else {
      console.error(e.message);
    }
  }
}

testSolver();
