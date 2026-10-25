// `npm start`: serves the built app (dist/) and the IPTV relay on one port, reachable from the whole home network.
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { handleApi } from './proxy.js';
import { startRecorder } from './recorder.js';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = +process.env.PORT || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const log = msg => console.log(new Date().toLocaleTimeString('sk-SK'), msg);

if (!existsSync(join(root, 'index.html'))) {
  console.error('Chýba priečinok dist/. Najprv spusti:  npm run build');
  process.exit(1);
}

startRecorder({ log });

http.createServer(async (req, res) => {
  if (await handleApi(req, res, { log })) return;
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] || 'application/octet-stream',
    'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n  Vysielač beží\n\n  Na tomto PC:      http://localhost:${PORT}`);
  lan.forEach(ip => console.log(`  V domácej sieti:  http://${ip}:${PORT}`));
  console.log('\n  Zastavíš ho klávesmi Ctrl+C.\n');
});
