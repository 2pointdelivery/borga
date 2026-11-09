const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.hbc': 'application/octet-stream' };
http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let p = path.join(root, urlPath === '/' ? 'index.html' : urlPath.slice(1));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(8090, () => console.log('serving dist on 8090'));
