import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const port = Number(process.env.PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.txt':'text/plain','.gz':'application/gzip'};
http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const name = decodeURIComponent(url.pathname);
    const path = resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const info = await stat(path);
    if (!info.isFile()) { res.writeHead(404).end(); return; }
    let file = path;
    const headers = {'Content-Type':types[extname(path)] || 'application/octet-stream','Cache-Control':name.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache','Vary':'Accept-Encoding','X-Content-Type-Options':'nosniff'};
    if (extname(path) !== '.gz') {
      const accept = req.headers['accept-encoding'] || '';
      for (const [encoding, suffix] of [['br','.br'],['gzip','.gz']]) {
        if (accept.includes(encoding)) {
          try { await stat(path + suffix); file = path + suffix; headers['Content-Encoding'] = encoding; break; } catch {}
        }
      }
    }
    const bytes = await readFile(file);
    headers['Content-Length'] = bytes.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port,'127.0.0.1',() => console.log(`Local: http://127.0.0.1:${port}`));
