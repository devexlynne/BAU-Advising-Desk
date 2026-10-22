/* Account recovery stays email-only: no visible or stored recovery codes. */
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 3186;
const DATA = './.test-data/recovery';
let passed = 0, failed = 0;
const check = (name, ok, detail) => {
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''));
  ok ? passed++ : failed++;
};

async function waitForServer(base) {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(base + '/health')).ok) return; } catch (e) { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('test server did not start');
}

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  const server = spawn(process.execPath, ['./server.js'], {
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DATA, ALLOW_UNVERIFIED_SIGNUP: 'true' }),
    stdio: 'ignore'
  });
  const base = 'http://127.0.0.1:' + PORT;
  try {
    await waitForServer(base);
    const signup = await fetch(base + '/api/signup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'may-itani', email: 'ma.itani@bau.edu.lb', password: 'test-password-2026' })
    });
    const body = await signup.json();
    check('sign-up succeeds without returning a recovery code', signup.ok && body.ok && !body.recoveryCode);

    await new Promise(resolve => setTimeout(resolve, 600));
    const raw = fs.readFileSync(DATA + '/store.json', 'utf8');
    check('no recovery-code hash or salt is stored for a new account', !/codeHash|codeSalt|recoveryCode/.test(raw));

    const oldRoute = await fetch(base + '/api/reset', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'may-itani', code: 'XXXX-XXXX-XXXX-XXXX', password: 'another-password-2026' })
    });
    const oldBody = await oldRoute.text();
    check('the old recovery-code reset route is unavailable',
      (oldRoute.status === 401 || oldRoute.status === 404) && !/recovery code/i.test(oldBody),
      'status ' + oldRoute.status);
  } finally {
    server.kill();
  }
  console.log('\n  ' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
