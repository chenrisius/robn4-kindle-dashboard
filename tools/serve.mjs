/* Serves out/ on the LAN so the Kindle can fetch the dashboard before any cloud
   deploy exists. Point the plugin at http://<this-mac>:8080 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(process.argv[2] || 'out');
const PORT = +(process.env.PORT || 8080);
const TYPES = { '.png': 'image/png', '.json': 'application/json', '.html': 'text/html' };

createServer(async (req, res) => {
  // normalize + prefix check keeps ../ out of the served root
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const path = join(ROOT, rel === '/' ? 'dashboard.json' : rel);
  if (!path.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const s = await stat(path);
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream',
      'content-length': s.size,
      'cache-control': 'no-cache',
    }).end(body);
    console.log(`200 ${rel} (${s.size} B)`);
  } catch {
    res.writeHead(404).end('not found');
    console.log(`404 ${rel}`);
  }
}).listen(PORT, () => {
  const ips = Object.values(networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`serving ${ROOT} on port ${PORT}`);
  for (const ip of ips) console.log(`  plugin URL:  http://${ip}:${PORT}`);
});
