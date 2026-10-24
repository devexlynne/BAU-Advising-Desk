/*
 * Offline demo: npm run demo
 *
 * Builds the portal and opens it on this computer only (127.0.0.1) with the
 * fictional students from demo/students.json, signed in as the demo advisor.
 * Nothing is sent anywhere and nothing is saved: the data lives in the page's
 * memory and resets when the page is reloaded. The demo PDFs in demo/ can be
 * dragged into the import screen to show an import.
 *
 * npm run demo -- --file writes the same demo as one HTML file
 * (build/advising-demo.html) that opens with a double-click, no Node needed.
 *
 * Refuses to run in production or on Railway.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_ID) {
  console.error('The demo runs on a local computer only. It is disabled in production and on Railway.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const port = Number(process.env.PORT || 3005);
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'students.json'), 'utf8'));
if (!seed.students.every(s => s.demo === true && /^20\d\d99\d{3}$/.test(s.id))) {
  console.error('demo/students.json must contain demo records only (demo: true, IDs in the 99xxx block).');
  process.exit(1);
}

execFileSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'inherit' });
const built = fs.readFileSync(path.join(ROOT, 'build', 'index.html'), 'utf8');

const data = JSON.stringify({ advisor: seed.advisor, students: seed.students }).replace(/</g, '\\u003c');
const head = '<script>window.OFFLINE_DEMO=true;window.DEMO_DATA=' + data + ';' +
  'sessionStorage.setItem("bau.session",' + JSON.stringify(seed.advisor) + ');' +
  // a small label so nobody mistakes the demo for the live portal
  'document.addEventListener("DOMContentLoaded",function(){var d=document.createElement("div");d.id="demo-ribbon";' +
  'd.textContent="DEMO: fictional students, nothing is saved";document.body.appendChild(d)});</script>' +
  '<style>#demo-ribbon{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:99999;' +
  'background:#A8842C;color:#fff;font:600 12px/1.2 system-ui,sans-serif;padding:6px 14px;border-radius:999px;' +
  'box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:none}</style>';
const page = built.replace('<head>', '<head>' + head);

if (process.argv.includes('--file')) {
  const out = path.join(ROOT, 'build', 'advising-demo.html');
  fs.writeFileSync(out, page);
  console.log('\nWrote ' + out + ' (' + Math.round(page.length / 1024) + ' KB). Double-click it to open the demo.');
  process.exit(0);
}

const files = {
  '/demo-transcripts.pdf': path.join(ROOT, 'demo', 'demo-transcripts.pdf'),
  '/demo-schedules.pdf': path.join(ROOT, 'demo', 'demo-schedules.pdf')
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page);
    return;
  }
  if (files[url.pathname]) {
    res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' });
    fs.createReadStream(files[url.pathname]).pipe(res);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  const link = 'http://127.0.0.1:' + port + '/';
  console.log('\nOffline demo running at ' + link);
  console.log(seed.students.length + ' fictional students, signed in as ' + seed.advisor + '. Nothing is saved.');
  console.log('Demo PDFs to import: demo/demo-transcripts.pdf and demo/demo-schedules.pdf');
  console.log('Press Ctrl+C to stop.\n');
  if (!process.env.NO_OPEN) {
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', link]]
      : process.platform === 'darwin' ? ['open', [link]] : ['xdg-open', [link]];
    try { spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch (e) { /* open it by hand */ }
  }
});
