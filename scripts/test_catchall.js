const Imap = require('imap');
const tests = ['outlook.office365.com', 'imap-mail.outlook.com'];

async function run() {
  for (const host of tests) {
    try {
      const res = await new Promise(resolve => {
        const imap = new Imap({ user: 'WandaBrown8051@outlook.com', password: 'silwwyupxowftwuc', host: host, port: 993, tls: true });
        imap.once('ready', () => { imap.end(); resolve('Success: ' + host); });
        imap.once('error', (err) => { resolve('Failed for ' + host + ': ' + err.message); });
        imap.connect();
      });
      console.log(res);
    } catch (e) {
      console.log(e);
    }
  }
}
run();
