import axios from 'axios';
async function test() {
  try {
    const res = await axios.post('http://localhost:8191/v1', {
      cmd: 'request.get',
      url: 'https://authenticator.cursor.sh/sign-up',
      maxTimeout: 10000,
      proxy: 'http://127.0.0.1:50000'
    });
    console.log(res.data);
  } catch(e: any) {
    console.error("DIAGNOSIS:", JSON.stringify(e.response?.data, null, 2));
  }
}
test();
