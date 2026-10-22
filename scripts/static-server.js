const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'build');
const port = Number(process.env.PORT || 3001);

if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_ID) {
  console.error('The unauthenticated preview server is disabled in production and on Railway.');
  process.exit(1);
}

const offlineDemo = '<script>window.OFFLINE_DEMO=true;</script>';
const enableOfflineDemo = html => html.replace('<head>', '<head>' + offlineDemo);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/__preview') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(
      '<!doctype html><script>sessionStorage.setItem("bau.session","julie-bu-daher");location.replace("/")</script>'
    );
    return;
  }
  if (pathname === '/__signin') {
    fs.readFile(path.join(root, 'index.html'), 'utf8', (error, html) => {
      if (error) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Preview unavailable');
        return;
      }
      const steady = '<style>*{animation:none!important;transition:none!important}</style>';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        .end(steady + enableOfflineDemo(html));
    });
    return;
  }
  if (pathname === '/__capture') {
    fs.readFile(path.join(root, 'index.html'), 'utf8', (error, html) => {
      if (error) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Preview unavailable');
        return;
      }
      const view = JSON.stringify(url.searchParams.get('view') || '');
      const student = JSON.stringify(url.searchParams.get('student') || '');
      const studentTab = JSON.stringify(url.searchParams.get('tab') || 'progress');
      const course = JSON.stringify(url.searchParams.get('course') || '');
      const scroll = Number(url.searchParams.get('scroll') || 0);
      const account = url.searchParams.get('account') === '1';
      const setup = '<script>sessionStorage.setItem("bau.session","julie-bu-daher")</script>';
      const capture = `<script>window.addEventListener('load',()=>setTimeout(()=>{
        const view=${view},student=${student},studentTab=${studentTab},course=${course};
        if(view){const button=document.querySelector('[data-view="'+view+'"]');if(button)button.click()}
        if(student){const row=document.querySelector('[data-open="'+student+'"]');if(row)row.click();setTimeout(()=>{const tab=document.querySelector('[data-tab="'+studentTab+'"]');if(tab)tab.click()},500)}
        ${account ? "setTimeout(()=>{const button=document.querySelector('[data-account]');if(button)button.click()},500);" : ''}
        if(course){setTimeout(()=>{const node=document.querySelector('g.gn[data-node="'+course+'"]');if(node)node.dispatchEvent(new MouseEvent('click',{bubbles:true}))},2200)}
        ${scroll ? `setTimeout(()=>{const pane=document.querySelector('#view');if(pane)pane.scrollTop=${scroll}},3400);` : ''}
      },2500))</script>`;
      html = setup + enableOfflineDemo(html) + capture;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
    });
    return;
  }
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, requested);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (error, body) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
    const content = file === path.join(root, 'index.html')
      ? enableOfflineDemo(body.toString('utf8'))
      : body;
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(content);
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Static portal preview on http://127.0.0.1:${server.address().port}`);
});
