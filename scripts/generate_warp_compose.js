const fs = require('fs');

const NUM_INSTANCES = 20;
const START_PORT = 9001;

let composeContent = `version: '3.8'\n\nservices:\n`;

for (let i = 0; i < NUM_INSTANCES; i++) {
  const nodeName = `warp-node-${i + 1}`;
  const port = START_PORT + i;
  
  composeContent += `  ${nodeName}:
    image: monius/docker-warp-socks:latest
    container_name: ${nodeName}
    ports:
      - "${port}:1080"
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
    sysctls:
      - net.ipv6.conf.all.disable_ipv6=0
      - net.ipv4.conf.all.src_valid_mark=1
\n`;
}

console.log(`Generating docker-compose.warp.yml with ${NUM_INSTANCES} WARP IPv6 Proxy nodes...`);
fs.writeFileSync('docker-compose.warp.yml', composeContent);
console.log(`✅ docker-compose.warp.yml generated!`);
console.log(`👉 To start the proxy pool, run: docker-compose -f docker-compose.warp.yml up -d`);
console.log(`👉 Ports mapped: 127.0.0.1:${START_PORT} to ${START_PORT + NUM_INSTANCES - 1}`);
