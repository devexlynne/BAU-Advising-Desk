/*
 * Public demo: the offline demo served from a host (Railway) so it can be
 * opened from a link. It serves one page with the fictional students from
 * demo/students.json, plus the two fictional PDFs. There is no database, no
 * sign-in and nothing is saved: each visitor's changes stay in their own
 * browser tab and vanish on reload.
 *
 *   node scripts/public-demo.js          (Railway: railway.demo.json)
 *
 * It only ever serves demo/students.json, and refuses to start unless every
 * record there is one of the fictional students in demo/tools/students-spec.json.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ROOT, loadSeed, buildPage } = require('./demo-page');

const seed = loadSeed(path.join(ROOT, 'demo', 'students.json'));
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'tools', 'students-spec.json'), 'utf8'));
const fictional = new Map(spec.map(s => [s.id, s.name]));
if (!seed.students.every(s => fictional.get(s.id) === s.name)) {
  console.error('demo/students.json has records that are not in the fictional demo list. Refusing to start.');
  process.exit(1);
}

const page = buildPage(seed, 'DEMO: fictional students, nothing is saved');
const pdfs = {
  '/demo-transcripts.pdf': path.join(ROOT, 'demo', 'demo-transcripts.pdf'),
  '/demo-schedules.pdf': path.join(ROOT, 'demo', 'demo-schedules.pdf')
};
const headers = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cache-control': 'no-store'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, headers).end();
    return;
  }
  if (url.pathname === '/health') {
    res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, headers)).end('{"ok":true,"demo":true}');
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, Object.assign({ 'content-type': 'text/html; charset=utf-8' }, headers)).end(page);
    return;
  }
  if (pdfs[url.pathname]) {
    res.writeHead(200, Object.assign({ 'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="' + url.pathname.slice(1) + '"' }, headers));
    fs.createReadStream(pdfs[url.pathname]).pipe(res);
    return;
  }
  res.writeHead(404, Object.assign({ 'content-type': 'text/plain; charset=utf-8' }, headers)).end('Not found');
});

const port = Number(process.env.PORT || 3006);
server.listen(port, () => console.log('Public demo on port ' + port + ' with ' + seed.students.length + ' fictional students.'));
['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => server.close(() => process.exit(0))));
