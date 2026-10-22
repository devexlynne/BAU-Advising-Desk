/* Run with: node tests/server-safety.test.js
   Server safeguards: a damaged store is never overwritten, sign-up stays closed
   without email verification, outgoing mail is limited to university
   addresses, sessions are not stored in plain text, and actions are audited. */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
};
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, '.test-data', 'safety');

async function waitFor(base) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/health')).ok) return; } catch (e) { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
const post = (base, p, body, cookie) => fetch(base + p, {
  method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {}),
  body: JSON.stringify(body)
});

(async () => {
  // Production never starts in file-storage mode when DATABASE_URL is absent.
  const productionDir = DATA + '-production';
  fs.rmSync(productionDir, { recursive: true, force: true });
  const production = spawnSync(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: '',
      RAILWAY_SERVICE_ID: '',
      DATABASE_URL: '',
      DATA_DIR: productionDir
    }),
    timeout: 8000
  });
  check('production refuses to start without PostgreSQL',
    production.status === 1 && /DATABASE_URL is required/.test(production.stderr), 'exit ' + production.status);
  check('failed production startup does not create a local store',
    !fs.existsSync(path.join(productionDir, 'store.json')));

  const unverifiedProduction = spawnSync(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: '',
      RAILWAY_SERVICE_ID: '',
      DATABASE_URL: '',
      ALLOW_UNVERIFIED_SIGNUP: 'true'
    }),
    timeout: 8000
  });
  check('production refuses unverified account activation',
    unverifiedProduction.status === 1
      && /ALLOW_UNVERIFIED_SIGNUP=true is not allowed in production/.test(unverifiedProduction.stderr),
    'exit ' + unverifiedProduction.status);

  // Student imports stay explicitly disabled until a production operator verifies storage.
  const disabledDir = DATA + '-imports-disabled';
  fs.rmSync(disabledDir, { recursive: true, force: true });
  let lockedServer = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: '3195', DATA_DIR: disabledDir, ALLOW_UNVERIFIED_SIGNUP: 'true',
      ENABLE_STUDENT_IMPORTS: 'false', MAIL_API_URL: '', MAIL_API_KEY: '', SMTP_URL: ''
    }),
    stdio: 'ignore'
  });
  const lockedBase = 'http://127.0.0.1:3195';
  try {
    await waitFor(lockedBase);
    const account = await post(lockedBase, '/api/signup', {
      slug: 'may-itani', email: 'ma.itani@bau.edu.lb', password: 'long-enough-pass-1'
    });
    const cookie = (account.headers.get('set-cookie') || '').split(';')[0];
    const denied = await post(lockedBase, '/api/students/save', {
      students: [{ id: '999900001', officialCgpa: 'abc' }]
    }, cookie);
    const blockedSet = await post(lockedBase, '/api/set', {
      path: 'advisors/may-itani/students/999900001',
      value: { id: '999900001' }
    }, cookie);
    const blockedDelete = await post(lockedBase, '/api/delete', {
      path: 'advisors/may-itani/students/999900001'
    }, cookie);
    check('bulk student imports remain blocked until explicitly enabled', denied.status === 503, 'status ' + denied.status);
    check('direct student writes remain blocked until explicitly enabled', blockedSet.status === 503, 'status ' + blockedSet.status);
    check('student deletion remains blocked until explicitly enabled', blockedDelete.status === 503, 'status ' + blockedDelete.status);
    const localState = JSON.parse(fs.readFileSync(path.join(disabledDir, 'store.json'), 'utf8'));
    check('blocked import did not write a student record',
      !Object.keys(localState).some(key => key.includes('/students/')));
  } finally { lockedServer.kill(); }

  // 1. a store that cannot be parsed stops the server and is left untouched
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'store.json'), '{"advisors/x/students/1": {"id": "1"');
  const bad = spawnSync(process.execPath, ['server.js'], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: '3191', DATA_DIR: DATA }), timeout: 8000
  });
  check('a damaged store stops the server', bad.status === 1, 'exit ' + bad.status);
  check('the damaged store is not overwritten',
    fs.readFileSync(path.join(DATA, 'store.json'), 'utf8') === '{"advisors/x/students/1": {"id": "1"');

  // 2. a bad numeric setting stops the server instead of disabling expiry
  const nan = spawnSync(process.execPath, ['server.js'], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: '3192', DATA_DIR: DATA + '-nan', SESSION_HOURS: 'twelve' }), timeout: 8000
  });
  check('an invalid SESSION_HOURS stops the server', nan.status === 1, 'exit ' + nan.status);

  // 3. without mail, sign-up is closed
  fs.rmSync(DATA, { recursive: true, force: true });
  let srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: '3193', DATA_DIR: DATA, MAIL_API_URL: '', MAIL_API_KEY: '', SMTP_URL: '' }), stdio: 'ignore'
  });
  let base = 'http://127.0.0.1:3193';
  try {
    await waitFor(base);
    const r = await post(base, '/api/signup', { slug: 'may-itani', email: 'ma.itani@bau.edu.lb', password: 'long-enough-pass-1' });
    check('sign-up is refused when email verification is unavailable', r.status === 503, 'status ' + r.status);
  } finally { srv.kill(); }

  // 4. development mode: sessions hashed, mail limited, actions audited
  fs.rmSync(DATA, { recursive: true, force: true });
  srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: Object.assign({}, process.env, {
      PORT: '3194', DATA_DIR: DATA, ALLOW_UNVERIFIED_SIGNUP: 'true',
      MAIL_API_URL: '', MAIL_API_KEY: '', SMTP_URL: ''
    }), stdio: 'ignore'
  });
  base = 'http://127.0.0.1:3194';
  try {
    await waitFor(base);
    const tooLong = await post(base, '/api/signup', { slug: 'may-itani', email: 'ma.itani@bau.edu.lb', password: 'x'.repeat(500) });
    check('an over-long password is refused', tooLong.status === 400, 'status ' + tooLong.status);
    const su = await post(base, '/api/signup', { slug: 'may-itani', email: 'ma.itani@bau.edu.lb', password: 'long-enough-pass-1' });
    check('development sign-up works', su.status === 200, 'status ' + su.status);
    const cookie = (su.headers.get('set-cookie') || '').split(';')[0];
    const sid = cookie.split('=')[1];

    const ext = await post(base, '/api/send', { to: 'someone@gmail.com', subject: 'x', text: 'hello' }, cookie);
    check('mail to a non-university address is refused', ext.status === 400 || ext.status === 503, 'status ' + ext.status);

    const wrong = await post(base, '/api/signin', { slug: 'may-itani', password: 'wrong-password-1' });
    check('a wrong password is refused', wrong.status === 401, 'status ' + wrong.status);

    const save = await post(base, '/api/students/save', { students: [{ id: '202600001', officialCgpa: 'abc' }] }, cookie);
    check('an import is accepted', save.status === 200, 'status ' + save.status);
    const got = await (await post(base, '/api/get', { path: 'advisors/may-itani/students/202600001' }, cookie)).json();
    check('numeric fields are cleaned on save', got.data && got.data.officialCgpa === null && got.data.updatedBy === 'may-itani');

    await new Promise(r => setTimeout(r, 700));
    const raw = fs.readFileSync(path.join(DATA, 'store.json'), 'utf8');
    check('the session cookie value is not stored in plain text', sid && !raw.includes(sid));
    const audit = fs.readFileSync(path.join(DATA, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const actions = audit.map(a => a.action);
    check('sign-up, failed sign-in and import are in the audit log',
      ['signup', 'signin-failed', 'students-save'].every(a => actions.includes(a)), actions.join(','));
    check('the audit log holds no passwords', !/long-enough-pass|wrong-password/.test(JSON.stringify(audit)));
    check('a backup snapshot was written', fs.readdirSync(path.join(DATA, 'backups')).some(f => /^store-.*\.json$/.test(f)));
  } finally { srv.kill(); }

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
