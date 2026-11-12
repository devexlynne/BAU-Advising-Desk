'use strict';
/* Backups, restore, key rotation and read auditing.
   Run with: node tests/backup-tools.test.js   (synthetic data only) */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const sealed = require('../src/encrypted-file');
const B = require('../server/backup-files');
const { PASSWORDS, defaultStore } = require('./helpers/auth-fixture');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, '.test-data', 'backup-tools');
const KEY = crypto.randomBytes(32).toString('hex');
const NEW_KEY = crypto.randomBytes(32).toString('base64');
const k = v => sealed.parseKey(v);
const PORT = 3301;
const URL_ = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' - ' + extra : ''));
};
const post = (p, body, cookie) => fetch(URL_ + p, {
  method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, cookie ? { cookie } : {}), body: JSON.stringify(body)
});
const signIn = async (email, password) => ((await post('/api/signin', { email, password })).headers.get('set-cookie') || '').split(';')[0];
const env = extra => Object.assign({}, process.env, { DATA_DIR: DATA, STORE_KEY: KEY, MAIL_API_URL: '', MAIL_API_KEY: '', SMTP_URL: '', DATABASE_URL: '', PORT: String(PORT) }, extra || {});
async function startServer(extra) {
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: env(extra), stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(URL_ + '/health')).ok) return proc; } catch (e) { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill(); throw new Error('server did not start');
}
const stop = async proc => { proc.kill(); await new Promise(r => proc.exitCode !== null ? r() : proc.once('exit', r)); };
const script = (name, args, extra) => spawnSync(process.execPath, [path.join('scripts', name)].concat(args),
  { cwd: ROOT, env: Object.assign({}, process.env, { DATA_DIR: DATA }, extra), encoding: 'utf8' });
const auditLines = key => fs.readFileSync(path.join(DATA, 'audit.log'), 'utf8').trim().split('\n')
  .map(l => JSON.parse(sealed.decrypt(key, JSON.parse(l))));

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  const seed = defaultStore();
  seed['advisors/synthetic-cs-advisor/students/999900021'] = { id: '999900021', name: 'Synthetic Student One' };
  seed['advisors/synthetic-cs-advisor/students/999900022'] = { id: '999900022', name: 'Synthetic Student Two' };
  fs.writeFileSync(path.join(DATA, 'store.json'), JSON.stringify(sealed.encrypt(k(KEY), JSON.stringify(seed))));

  // ---- endpoints and read auditing ----
  let srv = await startServer();
  let downloaded;
  try {
    const advisor = await signIn('test.advisor@bau.edu.lb', PASSWORDS.advisor);
    const admin = await signIn('test.superadmin@bau.edu.lb', PASSWORDS.admin);
    check('an advisor cannot see backup status', (await post('/api/admin/backup-status', {}, advisor)).status === 403);
    check('an advisor cannot download a backup', (await post('/api/admin/backup-download', {}, advisor)).status === 403);
    const st = await post('/api/admin/backup-status', {}, admin);
    const sj = await st.json();
    check('a superadmin sees backup status', st.status === 200 && sj.encrypted === true && sj.count >= 1 && sj.latest && !sj.lastDownload, JSON.stringify(sj));
    const dl = await post('/api/admin/backup-download', {}, admin);
    const dj = await dl.json();
    downloaded = dj;
    check('the download is the encrypted file, not plain data', dl.status === 200 && sealed.isEnvelope(JSON.parse(dj.file)) && !dj.file.includes('Synthetic Student'));
    const sj2 = await (await post('/api/admin/backup-status', {}, admin)).json();
    check('status remembers the last download', sj2.lastDownload && sj2.lastDownload.by === 'synthetic-superadmin');
    check('the internal _backup key cannot be read through the API', (await post('/api/get', { path: '_backup' }, admin)).status === 403);

    await post('/api/list', { path: 'advisors/synthetic-cs-advisor/students' }, advisor);
    await post('/api/list', { path: 'advisors/synthetic-cs-advisor/students' }, admin);
    await post('/api/get', { path: 'advisors/synthetic-cs-advisor/students/999900021' }, admin);
    await post('/api/all-students', {}, admin);
  } finally { await stop(srv); }

  const log = auditLines(k(KEY));
  const other = log.filter(e => e.action === 'read-other-students');
  check('reading your own list is not logged as another advisor\'s read', !other.some(e => e.actor === 'synthetic-cs-advisor'));
  check('a list read of another advisor\'s students is logged with the count',
    other.some(e => e.actor === 'synthetic-superadmin' && e.details.owner === 'synthetic-cs-advisor' && e.details.count === 2));
  check('a single record read is logged too', other.some(e => e.details.count === 1));
  check('the audit line has no student names', !JSON.stringify(other).includes('Synthetic Student'));
  const all = log.find(e => e.action === 'read-all-students');
  check('the all-students read records how many per advisor', all && all.details.advisors && all.details.advisors['synthetic-cs-advisor'] === 2);
  check('the download is in the audit log', log.some(e => e.action === 'backup-downloaded'));

  // ---- restore ----
  const backupFile = path.join(DATA, 'restore-me.json');
  fs.writeFileSync(backupFile, downloaded.file);
  const changed = defaultStore(); // a store where the two student records are gone
  fs.writeFileSync(path.join(DATA, 'store.json'), JSON.stringify(sealed.encrypt(k(KEY), JSON.stringify(changed))));
  const before = fs.readFileSync(path.join(DATA, 'store.json'), 'utf8');

  let r = script('restore-backup.js', [backupFile], { STORE_KEY: KEY });
  check('restore without --yes only checks the file', r.status === 0 && /backup ok/.test(r.stdout)
    && fs.readFileSync(path.join(DATA, 'store.json'), 'utf8') === before, r.stderr);
  r = script('restore-backup.js', [backupFile, '--yes'], { STORE_KEY: crypto.randomBytes(32).toString('hex') });
  check('restore with the wrong key fails and changes nothing', r.status === 1
    && fs.readFileSync(path.join(DATA, 'store.json'), 'utf8') === before);
  r = script('restore-backup.js', [backupFile, '--yes'], { STORE_KEY: KEY });
  const restored = B.readStoreFile(path.join(DATA, 'store.json'), k(KEY));
  check('restore puts the records back', r.status === 0 && restored['advisors/synthetic-cs-advisor/students/999900022'], r.stderr);
  const kept = fs.readdirSync(DATA).filter(f => f.startsWith('store.json.before-restore-'));
  check('the replaced store is kept, still encrypted', kept.length === 1
    && sealed.isEnvelope(JSON.parse(fs.readFileSync(path.join(DATA, kept[0]), 'utf8'))));
  fs.unlinkSync(backupFile);
  fs.unlinkSync(path.join(DATA, kept[0]));

  // ---- key rotation ----
  const backupsBefore = B.backupNames(path.join(DATA, 'backups')).length;
  r = script('rotate-store-key.js', ['--yes'], { STORE_KEY: crypto.randomBytes(32).toString('hex'), NEW_STORE_KEY: NEW_KEY });
  check('rotation with the wrong old key fails and changes nothing', r.status === 1
    && !!B.readStoreFile(path.join(DATA, 'store.json'), k(KEY)));
  r = script('rotate-store-key.js', ['--yes'], { STORE_KEY: KEY, NEW_STORE_KEY: NEW_KEY });
  check('rotation runs', r.status === 0, r.stderr);
  const readsWith = key => { try { B.readStoreFile(path.join(DATA, 'store.json'), key); return true; } catch (e) { return false; } };
  check('the store opens with the new key and not the old one', readsWith(k(NEW_KEY)) && !readsWith(k(KEY)));
  const backups = B.backupNames(path.join(DATA, 'backups'));
  check('every backup was re-encrypted', backups.length === backupsBefore && backups.every(n => {
    try { B.readStoreFile(path.join(DATA, 'backups', n), k(NEW_KEY)); return true; } catch (e) { return false; }
  }));
  check('every audit line was re-encrypted', auditLines(k(NEW_KEY)).length === log.length);

  srv = await startServer({ STORE_KEY: NEW_KEY });
  try {
    const advisor = await signIn('test.advisor@bau.edu.lb', PASSWORDS.advisor);
    const got = await (await post('/api/get', { path: 'advisors/synthetic-cs-advisor/students/999900021' }, advisor)).json();
    check('the server starts with the new key and the data is there', got.data && got.data.name === 'Synthetic Student One');
  } finally { await stop(srv); }

  fs.rmSync(DATA, { recursive: true, force: true });
  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
