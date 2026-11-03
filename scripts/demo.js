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
 * --seed <file>, --out <file> and --label <text> are used by
 * scripts/private-demo.js to build a private copy from another seed file.
 *
 * Refuses to run in production or on Railway.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadSeed, buildPage } = require('./demo-page');

if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_ID) {
  console.error('The demo runs on a local computer only. It is disabled in production and on Railway.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const port = Number(process.env.PORT || 3005);
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const seedFile = arg('--seed') ? path.resolve(arg('--seed')) : path.join(ROOT, 'demo', 'students.json');
const label = arg('--label') || 'DEMO: fictional students, nothing is saved';
let seed;
try { seed = loadSeed(seedFile); } catch (e) { console.error(e.message); process.exit(1); }
const page = buildPage(seed, label);

if (process.argv.includes('--file')) {
  const out = arg('--out') ? path.resolve(arg('--out')) : path.join(ROOT, 'build', 'advising-demo.html');
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
