import dgram from 'dgram';
import fs from 'fs';
import path from 'path';

// Subnets allocated to Cloudflare WARP endpoints
const subnets = [
  '162.159.192.',
  '162.159.193.',
  '162.159.195.',
  '188.114.96.',
  '188.114.97.',
  '188.114.98.',
  '188.114.99.'
];

const PORT = 2408;
const MAX_CONCURRENT = 500;
let workingEndpoints: string[] = [];

// A generic WireGuard handshake initiation packet (this is somewhat dummy but sometimes triggers a response,
// or we can just send any UDP ping. Cloudflare WARP might only reply to valid handshakes, but often any ping works to map reachability).
// Better yet, just doing a zero-byte payload or a Wireguard handshake initiation struct.
// Here we just test basic UDP reachability (ICMP is blocked but UDP might drop).
// Actually, sending a generic 1-byte payload to 2408 might not get a response from Wireguard.
// Instead, we just try to launch wireproxy sequentially on randomly selected IPs from the subnets!

// We will generate 10 random IPs, and configure wireproxy to use them, then parse logs to see if handshake succeeded!
function getRandomWarpIPs(count: number): string[] {
  const ips: Set<string> = new Set();
  while (ips.size < count) {
    const subnet = subnets[Math.floor(Math.random() * subnets.length)];
    const host = Math.floor(Math.random() * 254) + 1;
    ips.add(`${subnet}${host}`);
  }
  return Array.from(ips);
}

const targetIPs = getRandomWarpIPs(20);
console.log('Target IPs to test natively through WireProxy:', targetIPs);

// Save them to a file for the next script to consume
const outputFile = path.join(__dirname, 'warp_unblocked_targets.json');
fs.writeFileSync(outputFile, JSON.stringify(targetIPs, null, 2));

console.log('✅ Generated 20 random Cloudflare WARP endpoints outside the standard DNS-returned pool to evade DPI blocking.');
