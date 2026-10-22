const assert = require('assert');
const { execFileSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

function waitForPreview(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('preview server did not start')), 5000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error('preview server exited before starting: ' + code));
    });
  });
}

(async () => {
  const denied = spawnSync(NODE, ['scripts/static-server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: '',
      RAILWAY_SERVICE_ID: ''
    }),
    encoding: 'utf8',
    timeout: 5000
  });
  assert.strictEqual(denied.status, 1);
  assert.match(denied.stderr, /disabled in production and on Railway/);

  execFileSync(NODE, ['build.js'], { cwd: ROOT, stdio: 'ignore' });
  const html = fs.readFileSync(path.join(ROOT, 'build', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /window\.STUDENTS\s*=/);

  const preview = spawn(NODE, ['scripts/static-server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      NODE_ENV: 'test',
      PORT: '0',
      RAILWAY_ENVIRONMENT_NAME: '',
      RAILWAY_SERVICE_ID: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let port;
  try {
    port = await waitForPreview(preview);
    const response = await fetch('http://127.0.0.1:' + port + '/');
    assert.ok(response.ok);
    assert.match(await response.text(), /window\.OFFLINE_DEMO=true/);
  } finally {
    preview.kill();
  }

  console.log('  ok  production and Railway cannot start the preview server');
  console.log('  ok  builds omit student data and local preview is marked as demo-only');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
