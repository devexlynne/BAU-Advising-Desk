/*
 * Online Advising System - HTTP server.
 *
 * Serves the single-page client (build/index.html) and a small JSON API.
 * Responsibilities: account sign-up, sign-in and sessions, email verification
 * and password reset, per-advisor storage of student records, and an
 * append-only audit log. Student records are only sent to the advisor who
 * owns them (or a portal admin), never in the public page.
 *
 * Production state and audit events live in Railway PostgreSQL. JSON-file
 * storage is retained only for local development and isolated tests.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mail = require('./mail');
const { PostgresStore, createPool } = require('./src/postgres-store');
const sealed = require('./src/encrypted-file');
const OrgTree = require('./src/org-tree');
const Permissions = require('./src/permissions');

// ---- configuration -----------------------------------------------------------
const RAILWAY_DEPLOYMENT = !!(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_ID);
const PRODUCTION = process.env.NODE_ENV === 'production' || RAILWAY_DEPLOYMENT;

// Numeric settings are validated at start-up: a typo must stop the server, not
// silently disable session or link expiry.
function numberEnv(name, dflt, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.error('Invalid ' + name + '=' + JSON.stringify(raw) + ' (expected a number from ' + min + ' to ' + max + ')');
    process.exit(1);
  }
  return n;
}
const boolEnv = (name, dflt) => {
  const raw = String(process.env[name] || '').toLowerCase();
  return raw === '' ? dflt : raw === 'true' || raw === '1' || raw === 'yes';
};

const PORT = numberEnv('PORT', 3000, 1, 65535);
const DATA_DIR = process.env.DATA_DIR || (RAILWAY_DEPLOYMENT ? '/data' : path.join(__dirname, 'data-store'));
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
// STORE_KEY switches on encrypted file storage (store, backups and audit log
// written with AES-256-GCM). It is the only file storage allowed in production.
const STORE_KEY = process.env.STORE_KEY ? sealed.parseKey(process.env.STORE_KEY) : null;
const PAGE = path.join(__dirname, 'build', 'index.html');
const SESSION_HOURS = numberEnv('SESSION_HOURS', 12, 1, 168);
const SESSION_IDLE_MINUTES = numberEnv('SESSION_IDLE_MINUTES', 120, 5, 10080);
const RESET_MINUTES = numberEnv('RESET_MINUTES', 30, 5, 1440);
const VERIFY_HOURS = numberEnv('VERIFY_HOURS', 24, 1, 168);
const BACKUP_KEEP = numberEnv('BACKUP_KEEP', 72, 1, 10000);
const MAIL_PER_DAY = numberEnv('MAIL_PER_DAY', 200, 1, 10000);
const ENABLE_STUDENT_IMPORTS = boolEnv('ENABLE_STUDENT_IMPORTS', !PRODUCTION);
const ALLOW_SIGNUP = boolEnv('ALLOW_SIGNUP', true);
// Development only: lets accounts open without the email check when no mail
// service is configured. Never set this in production.
const ALLOW_UNVERIFIED_SIGNUP = boolEnv('ALLOW_UNVERIFIED_SIGNUP', false);
// Behind a reverse proxy (Railway, Render, nginx) the client address comes
// from X-Forwarded-For; when reached directly, that header cannot be trusted.
const TRUST_PROXY = boolEnv('TRUST_PROXY', true);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');   // base of emailed links
// Recipients the portal may email: university addresses only.
const MAIL_DOMAINS = String(process.env.MAIL_DOMAINS || 'bau.edu.lb,student.bau.edu.lb')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

// The legacy directory is read only during the one-time store migration.
const LEGACY_FACULTY = require('./data/faculty.json');
const LEGACY_ADMIN_SLUGS = LEGACY_FACULTY.filter(f => f && f.admin).map(f => f.slug);
const BOOTSTRAP_SUPERADMINS = String(process.env.ADMIN_SLUGS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const MIGRATION_ADMIN_SLUGS = BOOTSTRAP_SUPERADMINS.length
  ? BOOTSTRAP_SUPERADMINS : LEGACY_ADMIN_SLUGS;
const IDEAS_TO = process.env.IDEAS_TO || '';

// ---- storage --------------------------------------------------------------
function loadStore() {
  if (!fs.existsSync(DATA_FILE)) {
    console.warn(STORE_KEY ? 'No store yet; starting with an empty encrypted one.' : 'No local development store found; starting with an empty one.');
    return {};
  }
  try {
    let data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (sealed.isEnvelope(data)) {
      if (!STORE_KEY) throw new Error('the store is encrypted and STORE_KEY is not set');
      data = JSON.parse(sealed.decrypt(STORE_KEY, data));
    } else if (STORE_KEY && Object.keys(data || {}).length) {
      throw new Error('the store is not encrypted; it will not be read or replaced with STORE_KEY set');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data;
  } catch (e) {
    throw new Error('Cannot read the store; refusing to overwrite it: ' + e.message);
  }
}
const storeText = () => (STORE_KEY ? JSON.stringify(sealed.encrypt(STORE_KEY, JSON.stringify(store))) : JSON.stringify(store));
const auditText = line => (STORE_KEY ? JSON.stringify(sealed.encrypt(STORE_KEY, line)) : line);
let store = {};
let databaseStore = null;

function personOf(slug) {
  const person = store['people/' + slug];
  if (person) return person;
  if (BOOTSTRAP_SUPERADMINS.includes(String(slug))) return { slug, active: true, roles: [] };
  return null;
}

function canUser(slug, action, scopeNode) {
  return Permissions.can(personOf(slug), action, scopeNode, store['org/tree'] || OrgTree.DEFAULT_TREE,
    BOOTSTRAP_SUPERADMINS);
}

function isSuperadmin(slug) {
  return Permissions.isSuperadmin(personOf(slug), BOOTSTRAP_SUPERADMINS);
}

function scopesOf(person) {
  const scopes = new Set();
  (person && Array.isArray(person.roles) ? person.roles : []).forEach(assignment => {
    (assignment && Array.isArray(assignment.scopes) ? assignment.scopes : []).forEach(scope => scopes.add(scope));
  });
  return Array.from(scopes);
}

function canForOwner(actorSlug, ownerSlug, action) {
  if (actorSlug === ownerSlug) {
    const scopes = scopesOf(personOf(ownerSlug));
    return scopes.some(scope => canUser(actorSlug, action, scope));
  }
  return scopesOf(personOf(ownerSlug)).some(scope => canUser(actorSlug, action, scope));
}

function findPersonByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  return Object.keys(store).filter(key => /^people\/[a-z0-9-]+$/.test(key))
    .map(key => store[key]).find(person => person && person.email
      && String(person.email).trim().toLowerCase() === normalized) || null;
}

function allPeople() {
  return Object.keys(store).filter(key => /^people\/[a-z0-9-]+$/.test(key))
    .map(key => store[key]).filter(Boolean);
}

function ideaRecipients() {
  if (IDEAS_TO) return IDEAS_TO;
  return allPeople().filter(person => person.active !== false && person.email
    && (isSuperadmin(person.slug) || (person.roles || []).some(role => role.role === 'faculty-admin')))
    .map(person => person.email).join(',');
}

function inScopePeople(actorSlug) {
  return allPeople().filter(person => person.slug === actorSlug
    || scopesOf(person).some(scope => canUser(actorSlug, 'people:read', scope)));
}

function nodeKind(id) {
  const tree = store['org/tree'] || OrgTree.DEFAULT_TREE;
  for (const faculty of tree.faculties || []) {
    if (faculty.id === id) return 'faculty';
    for (const department of faculty.departments || []) {
      if (department.id === id) return 'department';
      for (const programme of department.programmes || []) {
        if (programme.id === id) return 'programme';
      }
    }
  }
  return id === 'bau' ? 'university' : null;
}

function validRoleAssignments(actorSlug, roles) {
  if (!Array.isArray(roles) || !roles.length || roles.length > 20) return false;
  const seen = new Set();
  for (const assignment of roles) {
    if (!assignment || !['superadmin', 'faculty-admin', 'programme-editor', 'approver', 'advisor', 'viewer'].includes(assignment.role)
      || !Array.isArray(assignment.scopes) || !assignment.scopes.length) return false;
    for (const scope of assignment.scopes) {
      const kind = nodeKind(scope);
      if (!kind || seen.has(assignment.role + ':' + scope)) return false;
      seen.add(assignment.role + ':' + scope);
      if (assignment.role === 'superadmin' && scope !== 'bau') return false;
      if (assignment.role === 'faculty-admin' && kind !== 'faculty') return false;
      if (['programme-editor', 'advisor', 'viewer'].includes(assignment.role) && kind !== 'programme') return false;
      if (assignment.role === 'approver' && !['faculty', 'programme'].includes(kind)) return false;
      if (!canUser(actorSlug, 'people:manage', scope)) return false;
      if (assignment.role === 'superadmin' && !isSuperadmin(actorSlug)) return false;
    }
  }
  return true;
}

function canManagePerson(actorSlug, target) {
  if (!target || target.slug === actorSlug) return true;
  if (isSuperadmin(target.slug) && !isSuperadmin(actorSlug)) return false;
  return scopesOf(target).some(scope => canUser(actorSlug, 'people:manage', scope));
}

function lastSuperadmin(slug) {
  if (BOOTSTRAP_SUPERADMINS.includes(String(slug))) return true;
  const active = allPeople().filter(person => person.active !== false
    && isSuperadmin(person.slug));
  return active.length <= 1 && active.some(person => person.slug === slug);
}

function inviteProfile(body) {
  const source = body && body.person;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const slug = String(source.slug || '').trim().toLowerCase();
  const email = String(source.email || '').trim().toLowerCase();
  if (!SLUG.test(slug) || !/^[^@\s]+@bau\.edu\.lb$/.test(email)) return null;
  const text = value => String(value || '').trim();
  return {
    slug,
    name: text(source.name),
    title: text(source.title),
    email,
    photo: typeof source.photo === 'string' ? source.photo : '',
    faculty: text(source.faculty),
    department: text(source.department),
    short: text(source.short),
    rank: text(source.rank),
    active: true,
    roles: body.roles
  };
}

// Write to a temporary file, flush it to disk, then rename over the old file,
// so a crash or power cut never leaves a half-written store.
function writeStoreFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, storeText()); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, DATA_FILE);
  backupIfDue();
}

// Local development snapshots only; production backups belong to PostgreSQL.
let lastBackup = 0;
function backupIfDue() {
  if (Date.now() - lastBackup < 3600e3) return;
  lastBackup = Date.now();
  try {
    const name = 'store-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, name));
    const all = fs.readdirSync(BACKUP_DIR).filter(f => /^store-.*\.json$/.test(f)).sort();
    all.slice(0, Math.max(0, all.length - BACKUP_KEEP)).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  } catch (e) { console.error('backup failed:', e.message); }
}

// Writes are batched briefly. API responses wait for the durable write.
let writing = null, writeTimer = null, dirty = false, storageFailure = null;
function save() {
  dirty = true;
  if (writeTimer || writing) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushStore().catch(e => {
      storageFailure = e;
      console.error('could not save application data:', e.code || e.message);
    });
  }, 100);
}

async function flushStore() {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  if (writing) {
    await writing;
    if (dirty) return flushStore();
    return;
  }
  if (!dirty) return;
  dirty = false;
  const snapshot = JSON.parse(JSON.stringify(store));
  const auditEntries = pendingAudits.splice(0);
  writing = (async () => {
    if (databaseStore) {
      await databaseStore.save(snapshot, auditEntries);
    } else {
      writeStoreFile();
      for (const entry of auditEntries) {
        const line = JSON.stringify(Object.assign({}, entry, entry.details));
        await fs.promises.appendFile(AUDIT_FILE, auditText(line) + '\n');
      }
    }
  })();
  try {
    await writing;
    storageFailure = null;
  } catch (e) {
    dirty = true;
    pendingAudits.unshift(...auditEntries);
    storageFailure = e;
    throw e;
  } finally {
    writing = null;
  }
  if (dirty) await flushStore();
}

// ---- audit log -------------------------------------------------------------
const pendingAudits = [];
function audit(actor, action, details) {
  const entry = {
    eventId: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor: actor || null,
    action,
    details: details || {}
  };
  pendingAudits.push(entry);
  save();
}

// ---- passwords -------------------------------------------------------------
// PBKDF2-SHA256 with a per-account salt, run off the event loop so a sign-in
// does not stall other requests. The plain password is never stored or logged.
const ITERATIONS = 310000;
const PASSWORD_MIN = 10, PASSWORD_MAX = 200;
const hash = (password, salt) => new Promise((resolve, reject) =>
  crypto.pbkdf2(String(password), 'bau:' + salt, ITERATIONS, 32, 'sha256',
    (e, key) => (e ? reject(e) : resolve(key.toString('hex')))));
const passwordProblem = pw => (pw.length < PASSWORD_MIN ? 'make the password at least ' + PASSWORD_MIN + ' characters'
  : pw.length > PASSWORD_MAX ? 'make the password at most ' + PASSWORD_MAX + ' characters' : '');
const newSalt = () => crypto.randomBytes(16).toString('hex');
// constant-time compare for hashes/codes
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
// ---- sessions --------------------------------------------------------------
// Kept in the store (so a redeploy does not sign everyone out) under the SHA-256
// of the cookie value: a copy of the store does not contain usable sessions.
const tokenHash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
function sessions() { return store['_sessions'] || (store['_sessions'] = {}); }
function newSession(slug) {
  const id = crypto.randomBytes(32).toString('hex');
  sessions()[tokenHash(id)] = { slug, at: Date.now(), seen: Date.now() };
  sweepSessions();
  save();
  return id;
}
const sessionExpired = rec => Date.now() - rec.at > SESSION_HOURS * 3600e3
  || Date.now() - (rec.seen || rec.at) > SESSION_IDLE_MINUTES * 60e3;
function sweepSessions() {
  const s = sessions();
  Object.keys(s).forEach(k => { if (!s[k] || sessionExpired(s[k])) delete s[k]; });
}
function sessionOf(req) {
  const raw = req.headers.cookie || '';
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(raw);
  if (!m) return null;
  const key = tokenHash(m[1]);
  const rec = sessions()[key];
  if (!rec) return null;
  if (sessionExpired(rec)) { delete sessions()[key]; save(); return null; }
  // activity keeps the session alive; written at most every few minutes
  if (Date.now() - (rec.seen || rec.at) > 5 * 60e3) { rec.seen = Date.now(); save(); }
  return { id: key, slug: rec.slug };
}
function endSession(req) {
  const s = sessionOf(req);
  if (s) { delete sessions()[s.id]; save(); }
}
function endSessionsOf(slug, exceptId) {
  const s = sessions();
  Object.keys(s).forEach(k => { if (s[k] && s[k].slug === slug && k !== exceptId) delete s[k]; });
}
// HttpOnly + SameSite=Lax always; Secure over https (or when PUBLIC_URL is https)
const cookieFor = (id, secure) =>
  'sid=' + id + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + SESSION_HOURS * 3600 + (secure ? '; Secure' : '');
const clearCookie = secure => 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '');

// ---- reset links -----------------------------------------------------------
// Emailed to the account's address. Only the hash is stored; single use,
// expires after RESET_MINUTES.
function resets() { return store['_resets'] || (store['_resets'] = {}); }
function newResetToken(slug) {
  const t = crypto.randomBytes(32).toString('hex');
  sweepResets(); dropResets(slug);          // only the latest link works
  resets()[tokenHash(t)] = { slug, at: Date.now() };
  save();
  return t;
}
function sweepResets() {
  const r = resets(), cutoff = Date.now() - RESET_MINUTES * 60e3;
  Object.keys(r).forEach(k => { if (!r[k] || r[k].at < cutoff) delete r[k]; });
}
function useResetToken(token) {
  sweepResets();
  const k = tokenHash(token || '');
  const rec = resets()[k];
  if (!rec) return null;
  delete resets()[k];                      // good once
  save();
  return rec.slug;
}
// ---- new-account verification links ----------------------------------------
// A new account stays locked until its owner opens the link sent to their BAU
// address and types the password they chose. Requiring the password prevents a
// third party who signs up under someone else's name from having their own
// password confirmed when the real owner clicks the link.
function verifies() { return store['_verifies'] || (store['_verifies'] = {}); }
function sweepVerifies() {
  const v = verifies(), cutoff = Date.now() - VERIFY_HOURS * 3600e3;
  Object.keys(v).forEach(k => { if (!v[k] || v[k].at < cutoff) delete v[k]; });
}
function dropVerifies(slug) {
  const v = verifies();
  Object.keys(v).forEach(k => { if (v[k] && v[k].slug === slug) delete v[k]; });
}
function newVerifyToken(slug, purpose) {
  const t = crypto.randomBytes(32).toString('hex');
  sweepVerifies(); dropVerifies(slug);          // only the latest link works
  verifies()[tokenHash(t)] = { slug, at: Date.now(), ...(purpose ? { purpose } : {}) };
  save();
  return t;
}
function verifyRecord(token) {
  sweepVerifies();
  return verifies()[tokenHash(token || '')] || null;
}
/* Account emails: HTML with a button plus the plain link as a fallback.
   Inline styles only (what most mail clients keep). The only variable part is
   the link, built from PUBLIC_URL and a hex token. */
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function accountEmailHtml({ title, intro, button, link, after }) {
  const L = escHtml(link);
  return ('<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fa">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:24px 0"><tr><td align="center">'
    + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:10px;border:1px solid #e3e7ef;font-family:Segoe UI,Arial,sans-serif;color:#1b2a5c">'
    + '<tr><td style="background:#1b2a5c;color:#ffffff;padding:16px 24px;border-radius:10px 10px 0 0;font-size:15px;font-weight:600">Online Advising System &middot; Beirut Arab University</td></tr>'
    + '<tr><td style="padding:26px 24px 8px 24px"><h1 style="margin:0 0 12px 0;font-size:20px;color:#1b2a5c">' + escHtml(title) + '</h1>'
    + '<p style="margin:0 0 20px 0;font-size:15px;line-height:1.5;color:#33415c">' + escHtml(intro) + '</p>'
    + '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#1b2a5c">'
    + '<a href="' + L + '" target="_blank" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">' + escHtml(button) + '</a>'
    + '</td></tr></table>'
    + '<p style="margin:22px 0 6px 0;font-size:13px;color:#5b6475">If the button does not work, copy this link into your browser:</p>'
    + '<p style="margin:0 0 20px 0;font-size:13px;word-break:break-all"><a href="' + L + '" style="color:#1b2a5c">' + L + '</a></p>'
    + '<p style="margin:0 0 22px 0;font-size:13px;line-height:1.5;color:#5b6475">' + escHtml(after) + '</p></td></tr>'
    + '<tr><td style="padding:14px 24px;border-top:1px solid #e3e7ef;font-size:12px;color:#8a93a6">Faculty of Science &middot; Department of Mathematics and Computer Science</td></tr>'
    + '</table></td></tr></table></body></html>')
    .replace(/></g, '>\n<');   // short lines: SMTP refuses lines over 998 characters
}

// verification needs a mail service and the portal's public address
const canVerify = () => mail.configured() && !!PUBLIC_URL;
const isVerified = acct => !!acct && acct.verified !== false;   // older accounts without the flag count as verified
function sendVerifyEmail(acct) {
  const link = PUBLIC_URL + '/?verify=' + newVerifyToken(acct.slug);
  const text = [
    'Your account on the Online Advising System is almost ready.',
    '',
    'To activate it, open this link within ' + VERIFY_HOURS + ' hours and type the password you chose:',
    link,
    '',
    'If you did not create this account, you can ignore this message. It stays locked',
    'and you can create your own account with your own password.',
    '',
    'Beirut Arab University, Faculty of Science',
    'Department of Mathematics and Computer Science'
  ].join('\n');
  const html = accountEmailHtml({
    title: 'Activate your account',
    intro: 'Your account on the Online Advising System is almost ready. Click the button and type the password you chose. The link works for ' + VERIFY_HOURS + ' hours.',
    button: 'Activate my account', link,
    after: 'If you did not create this account, you can ignore this message. It stays locked and you can create your own account with your own password.'
  });
  return mail.send(acct.email, 'Activate your Online Advising System account', text, undefined, html);
}

const isTestAddress = email => /^test\.[^@\s]+@bau\.edu\.lb$/i.test(String(email || '').trim());
function invitationLink(req, slug, purpose) {
  const token = newVerifyToken(slug, purpose || 'invite');
  const base = PUBLIC_URL || ((isHttps(req) ? 'https://' : 'http://') + (req.headers.host || 'localhost'));
  return base + '/?verify=' + token;
}
function sendInviteEmail(person, link) {
  const text = [
    'You have been invited to the Online Advising System.',
    '',
    'To set your password and activate your account, open this link within ' + VERIFY_HOURS + ' hours:',
    link,
    '',
    'If you were not expecting this invitation, contact your department administrator.'
  ].join('\n');
  const html = accountEmailHtml({
    title: 'You are invited',
    intro: 'You have been invited to the Online Advising System. Open the link to set your password and activate your account.',
    button: 'Set my password',
    link,
    after: 'The link expires after ' + VERIFY_HOURS + ' hours and works once. If you were not expecting this invitation, contact your department administrator.'
  });
  return mail.send(person.email, 'Your Online Advising System invitation', text, undefined, html);
}

function dropResets(slug) {
  const r = resets();
  Object.keys(r).forEach(k => { if (r[k] && r[k].slug === slug) delete r[k]; });
}
function resetLink(req, token) {
  const base = PUBLIC_URL || ((isHttps(req) ? 'https://' : 'http://') + (req.headers.host || 'localhost'));
  return base + '/?reset=' + token;
}

// ---- rate limiting (per account + ip) --------------------------------------
const attempts = new Map();          // key -> { n, until }
function tooMany(key) {
  const a = attempts.get(key);
  return !!(a && a.until > Date.now());
}
function failed(key) {
  const a = attempts.get(key) || { n: 0, until: 0 };
  a.n += 1;
  // 5 free tries, then the wait doubles: 30s, 1m, 2m ... capped at 15 min
  if (a.n > 5) a.until = Date.now() + Math.min(15 * 60e3, 30e3 * Math.pow(2, a.n - 6));
  attempts.set(key, a);
}
const cleared = key => attempts.delete(key);
// drop expired counters every 10 minutes so the map cannot grow without bound
setInterval(() => {
  const now = Date.now();
  attempts.forEach((a, k) => { if (a.until < now - 3600e3) attempts.delete(k); });
}, 10 * 60e3).unref();

// ---- helpers ---------------------------------------------------------------
const isHttps = req => /^https:/.test(PUBLIC_URL)
  || (TRUST_PROXY && (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');

async function json(res, code, body, extraHeaders) {
  if (dirty || writing) {
    try {
      await flushStore();
    } catch (e) {
      console.error('application data write failed:', e.code || e.message);
      code = 503;
      body = { error: 'secure storage is unavailable; the request was not confirmed' };
    }
  }
  if (storageFailure && code < 500) {
    code = 503;
    body = { error: 'secure storage is unavailable; contact the administrator' };
  }
  const h = Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }, extraHeaders || {});
  res.writeHead(code, h);
  res.end(JSON.stringify(body));
}

function readBody(req, forPath) {
  // Only imports/record writes get the 40MB limit (whole transcripts).
  // Everything else, sign-in included, is capped at 256KB so nobody can make
  // us hold 40MB in memory just by posting to a login route.
  const big = /^\/api\/(set|students\/save)$/.test(forPath || '');
  const cap = big ? 40 * 1024 * 1024 : 256 * 1024;
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', c => {
      n += c.length;
      if (n > cap) { reject(new Error('that request is too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => {
      try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); }
      catch (e) { reject(new Error('bad request body')); }
    });
    req.on('error', reject);
  });
}

/* Behind a proxy the real address is the LAST X-Forwarded-For entry (earlier
   entries come from the client and can be forged). */
function clientIp(req) {
  if (!TRUST_PROXY) return (req.socket && req.socket.remoteAddress) || 'local';
  const xs = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return xs.length ? xs[xs.length - 1] : ((req.socket && req.socket.remoteAddress) || 'local');
}
const acctKey = slug => 'advisors/' + slug + '/account';
const SLUG = /^[a-z0-9-]{2,60}$/;
const PATH_OK = /^[A-Za-z0-9._\-/]{1,200}$/;

// emails sent per advisor per day (memory; resets on restart)
const mailCount = new Map();

// Numeric fields of a student record must be numbers (or null) before they
// are stored; the client formats them and a stray string would break pages.
const NUMERIC_FIELDS = ['officialCgpa', 'officialCredits', 'catalogYear'];
function cleanStudent(st) {
  NUMERIC_FIELDS.forEach(f => {
    if (st[f] === undefined || st[f] === null || st[f] === '') return;
    const n = Number(st[f]);
    st[f] = Number.isFinite(n) ? n : null;
  });
  return st;
}

/* All generic storage access is checked here as well as by action-specific routes. */
function mayTouch(slug, key, operation) {
  if (!PATH_OK.test(key)) return false;
  if (key.indexOf('..') >= 0) return false;
  if (/\/account$/.test(key)) return false;          // accounts go through the sign-in routes
  if (key.charAt(0) === '_') return false;           // sessions, tokens, internal state
  const write = operation === 'write';
  const ownerMatch = /^advisors\/([a-z0-9-]+)\//.exec(key);
  if (ownerMatch) {
    const owner = ownerMatch[1];
    if (/^advisors\/[a-z0-9-]+\/students\//.test(key)) {
      return canForOwner(slug, owner, write ? 'students:write' : 'students:read');
    }
    return owner === slug || (canForOwner(slug, owner, 'students:read')
      && scopesOf(personOf(owner)).some(scope => canUser(slug, 'students:clear', scope)));
  }
  const rule = /^config\/([a-z0-9-]+)\/rules$/.exec(key);
  if (rule) return canUser(slug, write ? 'rules:write' : 'rules:read', rule[1]);
  if (key.indexOf('offering/') === 0) return canUser(slug, write ? 'offering:write' : 'offering:read');
  if (key.indexOf('brand/') === 0) return canUser(slug, write ? 'brand:write' : 'brand:read');
  if (key.indexOf('ideas/') === 0) return canUser(slug, 'ideas:' + (write ? 'write' : 'read'));
  return false;
}

// ---- API -------------------------------------------------------------------
async function api(req, res, url) {
  const p = url.pathname;
  const secure = isHttps(req);
  const ip = clientIp(req);

  if (p === '/api/session') {
    let s = sessionOf(req);
    if (s && (!personOf(s.slug) || personOf(s.slug).active === false)) {
      delete sessions()[s.id];
      save();
      s = null;
    }
    return json(res, 200, {
      slug: s ? s.slug : null, admin: !!(s && isSuperadmin(s.slug)),
      signupAllowed: ALLOW_SIGNUP, mail: mail.configured()
    });
  }

  if (p === '/api/accounts') {
    const me = sessionOf(req);
    if (!me || !personOf(me.slug) || personOf(me.slug).active === false) {
      return json(res, 401, { error: 'please sign in' });
    }
    const out = {};
    inScopePeople(me.slug).forEach(person => {
      const account = store[acctKey(person.slug)];
      if (account && isVerified(account)) out[person.slug] = true;
    });
    return json(res, 200, { accounts: out });
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  let body;
  if (req.method === 'POST' && !sameOrigin(req)) {
    return json(res, 403, { error: 'that request did not come from the portal' });
  }
  const AUTH = ['/api/signin', '/api/signup', '/api/password', '/api/reset', '/api/recover', '/api/forgot', '/api/verify'];
  if (AUTH.some(a => p.indexOf(a) === 0) && tooManyFrom(req)) {
    return json(res, 429, { error: 'too many attempts from this connection. Wait a few minutes and try again.' });
  }
  // the 40MB limit is only for signed-in users on the write routes; everyone else gets 256KB
  const preSession = sessionOf(req);
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > (preSession ? 40 : 0.25) * 1024 * 1024) return json(res, 413, { error: 'that request is too large' });
  try { body = await readBody(req, preSession ? p : '/api/small'); } catch (e) { return json(res, 400, { error: e.message }); }

  if (p === '/api/signup') return json(res, 403, { error: 'accounts are created by invitation only' });

  if (p === '/api/signin') {
    const email = String(body.email || '').trim().toLowerCase();
    const person = findPersonByEmail(email);
    const slug = person && person.slug;
    const key = 'in:' + (email || 'missing-email') + ':' + ip;
    if (!/^[^@\s]+@bau\.edu\.lb$/.test(email)) {
      await hash(String(body.password || '').slice(0, PASSWORD_MAX), 'no-account');
      failed(key);
      return json(res, 401, { error: 'that email and password do not match' });
    }
    const acct = slug ? store[acctKey(slug)] : null;
    const acctTries = 'in-acct:' + (slug || email);      // per account, whatever address it comes from
    if (tooMany(key) || tooMany(acctTries)) return json(res, 429, { error: 'too many tries, wait a few minutes' });
    const password = String(body.password || '').slice(0, PASSWORD_MAX);
    // hash even for an unknown name, so response time does not reveal which accounts exist
    const given = await hash(password, acct ? acct.salt : 'no-account');
    if (!acct || !sameSecret(given, acct.hash) || !person || person.active === false) {
      failed(key); if (acct) failed(acctTries);
      audit(slug || null, 'signin-failed', { ip });
      return json(res, 401, { error: 'that email and password do not match' });
    }
    cleared(key); cleared(acctTries);
    if (!isVerified(acct)) {
      return json(res, 403, { error: 'this account is not active yet. Open the invitation link sent to your BAU email', unverified: true });
    }
    acct.lastSignIn = Date.now(); save();
    audit(slug, 'signin', { ip });
    return json(res, 200, { ok: true, slug, admin: isSuperadmin(slug) },
      { 'set-cookie': cookieFor(newSession(slug), secure) });
  }

  if (p === '/api/signout') {
    endSession(req);
    return json(res, 200, { ok: true }, { 'set-cookie': clearCookie(secure) });
  }

  // opened from the new-account email: the token plus the password chosen at sign-up
  if (p === '/api/verify') {
    const key = 'ver:' + ip;
    if (tooMany(key)) return json(res, 429, { error: 'too many tries, wait a few minutes' });
    const rec = verifyRecord(String(body.token || ''));
    if (!rec) return json(res, 401, { error: 'that link has expired or a newer one was sent. Create the account again to get a new link' });
    const invitedPerson = personOf(rec.slug);
    if (rec.purpose === 'invite') {
      if (!invitedPerson || invitedPerson.active === false) {
        return json(res, 404, { error: 'that invitation is no longer active; contact your administrator' });
      }
      if (store[acctKey(rec.slug)]) return json(res, 409, { error: 'that invitation has already been used' });
      const password = String(body.password || '');
      const pwBad = passwordProblem(password);
      if (pwBad) return json(res, 400, { error: pwBad });
      const salt = newSalt();
      store[acctKey(rec.slug)] = {
        slug: rec.slug, email: invitedPerson.email, salt,
        hash: await hash(password, salt),
        createdAt: Date.now(), lastSignIn: Date.now(), verified: true, verifiedAt: Date.now()
      };
      dropVerifies(rec.slug);
      save();
      audit(rec.slug, 'invite-accepted', { ip, before: null, after: { active: true, verified: true } });
      return json(res, 200, { ok: true, slug: rec.slug, admin: isSuperadmin(rec.slug) },
        { 'set-cookie': cookieFor(newSession(rec.slug), secure) });
    }
    const acct = store[acctKey(rec.slug)];
    if (!acct) return json(res, 404, { error: 'that account no longer exists. Create it again' });
    if (!invitedPerson || invitedPerson.active === false) {
      return json(res, 403, { error: 'this account is no longer active; contact your administrator' });
    }
    if (tooMany('ver-acct:' + rec.slug)) return json(res, 429, { error: 'too many tries, wait a few minutes' });
    if (!sameSecret(await hash(String(body.password || '').slice(0, PASSWORD_MAX), acct.salt), acct.hash)) {
      failed(key); failed('ver-acct:' + rec.slug);
      return json(res, 401, { error: 'that is not the password chosen when this account was created' });
    }
    cleared(key); cleared('ver-acct:' + rec.slug); cleared('su-acct:' + rec.slug);
    acct.verified = true; acct.verifiedAt = Date.now(); acct.lastSignIn = Date.now();
    dropVerifies(rec.slug);
    save();
    audit(rec.slug, 'account-verified', { ip });
    return json(res, 200, { ok: true, slug: rec.slug, admin: isSuperadmin(rec.slug) },
      { 'set-cookie': cookieFor(newSession(rec.slug), secure) });
  }

  // "Send the link again", for an account that is waiting. Needs the password,
  // so nobody else can fill the advisor's inbox.
  if (p === '/api/verify-resend') {
    const slug = String(body.slug || '');
    if (!SLUG.test(slug)) return json(res, 400, { error: 'unknown advisor' });
    const key = 'vres:' + slug;
    if (tooMany(key)) return json(res, 429, { error: 'too many tries, wait a few minutes' });
    failed(key);
    const acct = store[acctKey(slug)];
    if (!acct || isVerified(acct) || !canVerify()) return json(res, 200, { ok: true });
    if (!sameSecret(await hash(String(body.password || '').slice(0, PASSWORD_MAX), acct.salt), acct.hash)) {
      return json(res, 401, { error: 'that name and password do not match' });
    }
    try { await sendVerifyEmail(acct); }
    catch (e) {
      console.error('could not send the verification email:', e.message);
      return json(res, 502, { error: 'the email could not be sent. Try again in a few minutes' });
    }
    return json(res, 200, { ok: true, email: acct.email });
  }

  // "Email me a link". Same answer whether or not the account exists, so this
  // can't be used to find out who has one.
  if (p === '/api/reset-request') {
    const email = String(body.email || '').trim().toLowerCase();
    const legacySlug = String(body.slug || '');
    const person = email ? findPersonByEmail(email)
      : (SLUG.test(legacySlug) ? personOf(legacySlug) : null);
    const slug = person && person.slug;
    const key = 'req:' + (email || legacySlug || 'missing-email') + ':' + ip;
    if (tooMany(key) || (slug && tooMany('req-acct:' + slug))) return json(res, 429, { error: 'too many tries, wait a few minutes' });
    failed(key); if (slug) failed('req-acct:' + slug);
    const acct = store[acctKey(slug)];
    // emailed links always use PUBLIC_URL, never the request's Host header
    if (person && person.active !== false && acct && acct.email && mail.configured() && PUBLIC_URL) {
      const link = PUBLIC_URL + '/?reset=' + newResetToken(slug);
      const text = [
        'Someone asked to reset the password for your Online Advising System account.',
        '',
        'If it was you, open this link within ' + RESET_MINUTES + ' minutes and choose a new password:',
        link,
        '',
        'The link works once. If it was not you, ignore this message: nothing changes',
        'until the link is opened, and your current password still works.',
        '',
        'Beirut Arab University'
      ].join('\n');
      const html = accountEmailHtml({
        title: 'Reset your password',
        intro: 'Someone asked to reset the password for your Online Advising System account. If it was you, click the button within ' + RESET_MINUTES + ' minutes and choose a new password.',
        button: 'Choose a new password', link,
        after: 'The link works once. If it was not you, ignore this message: nothing changes until the link is opened, and your current password still works.'
      });
      mail.send(acct.email, 'Reset your Online Advising System password', text, undefined, html)
        .catch(e => console.error('could not send the reset email:', e.message));
      audit(slug, 'reset-requested', { ip });
    }
    // Deliberately do not reveal an address or whether an account exists.
    return json(res, 200, { ok: true, mail: mail.configured() });
  }

  // the token proves they can read the BAU mailbox
  if (p === '/api/reset-with-link') {
    const next = String(body.password || '');
    const pwBad = passwordProblem(next);
    if (pwBad) return json(res, 400, { error: pwBad });
    const slug = useResetToken(String(body.token || ''));
    if (!slug) return json(res, 401, { error: 'that link has expired or was already used' });
    const acct = store[acctKey(slug)];
    if (!acct || !personOf(slug) || personOf(slug).active === false) {
      return json(res, 404, { error: 'no active account' });
    }
    acct.salt = newSalt();
    acct.hash = await hash(next, acct.salt);
    acct.changedAt = Date.now();
    acct.verified = true;                  // the link came through their BAU inbox
    dropVerifies(slug);
    dropResets(slug);
    endSessionsOf(slug);
    save();
    audit(slug, 'password-reset', { ip });
    return json(res, 200, { ok: true, slug },
      { 'set-cookie': cookieFor(newSession(slug), secure) });
  }

  // ---- everything below needs a session ----
  const me = sessionOf(req);
  if (!me) return json(res, 401, { error: 'please sign in' });
  if (!personOf(me.slug) || personOf(me.slug).active === false) {
    endSession(req);
    return json(res, 401, { error: 'this account is no longer active' });
  }

  if (p === '/api/org/tree') {
    if (!isSuperadmin(me.slug)) return json(res, 403, { error: 'only a superadmin can change the organisation tree' });
    if (body.tree === undefined) return json(res, 200, { tree: store['org/tree'] || OrgTree.DEFAULT_TREE });
    const result = OrgTree.validateTree(body.tree);
    if (!result.ok) return json(res, 400, { error: result.error });
    const referenced = allPeople().flatMap(person => person.roles || [])
      .flatMap(role => role.scopes || []);
    if (referenced.some(scope => !OrgTree.findNode(body.tree, scope))) {
      return json(res, 409, { error: 'the organisation tree cannot remove a scope assigned to a person' });
    }
    const before = store['org/tree'] || null;
    if (JSON.stringify(before) !== JSON.stringify(body.tree)) {
      store['org/tree'] = body.tree;
      save();
      audit(me.slug, 'org-tree-changed', { before, after: body.tree, ip });
    }
    return json(res, 200, { ok: true, tree: store['org/tree'] });
  }

  if (p === '/api/people/list') {
    if (!canUser(me.slug, 'people:read', scopesOf(personOf(me.slug))[0])) {
      return json(res, 403, { error: 'no people are available in your scope' });
    }
    const people = inScopePeople(me.slug).map(person => ({
      slug: person.slug,
      name: person.name,
      title: person.title,
      email: person.email,
      photo: person.photo || '',
      faculty: person.faculty || '',
      department: person.department || '',
      short: person.short || '',
      rank: person.rank || '',
      honorific: person.honorific,
      keepOnBulkClear: !!person.keepOnBulkClear,
      active: person.active !== false,
      verified: !!store[acctKey(person.slug)] && isVerified(store[acctKey(person.slug)]),
      roles: Array.isArray(person.roles) ? person.roles : []
    }));
    return json(res, 200, { people });
  }

  if (p === '/api/people/invite') {
    const person = inviteProfile(body);
    if (!person) return json(res, 400, { error: 'provide a valid person profile and BAU email address' });
    if (allPeople().some(existing => existing.slug === person.slug
      || String(existing.email || '').toLowerCase() === person.email)) {
      return json(res, 409, { error: 'a person with that slug or email already exists' });
    }
    if (!canUser(me.slug, 'people:manage', body.roles && body.roles[0] && body.roles[0].scopes && body.roles[0].scopes[0])) {
      return json(res, 403, { error: 'you cannot invite people outside your scope' });
    }
    if (!validRoleAssignments(me.slug, person.roles)) {
      return json(res, 400, { error: 'the role or scope is invalid or outside your authority' });
    }
    if (person.name.length > 200 || person.title.length > 200
      || person.faculty.length > 200 || person.department.length > 200
      || person.photo.length > 200000) {
      return json(res, 400, { error: 'a profile field is too long' });
    }
    const link = invitationLink(req, person.slug, 'invite');
    store['people/' + person.slug] = person;
    if (isTestAddress(person.email)) {
      console.log('Synthetic test invitation for ' + person.email + ': ' + link);
    } else if (canVerify()) {
      try { await sendInviteEmail(person, link); }
      catch (error) {
        delete store['people/' + person.slug];
        dropVerifies(person.slug);
        save();
        console.error('could not send the invitation email:', error.message);
        return json(res, 502, { error: 'the invitation email could not be sent' });
      }
    } else if (ALLOW_UNVERIFIED_SIGNUP && !PRODUCTION) {
      console.log('Development invitation for ' + person.email + ': ' + link);
    } else {
      delete store['people/' + person.slug];
      dropVerifies(person.slug);
      save();
      return json(res, 503, { error: 'invitations are unavailable until email and PUBLIC_URL are configured' });
    }
    save();
    audit(me.slug, 'person-invited', { target: person.slug, before: null, after: {
      profile: person, roles: person.roles
    }, ip });
    return json(res, 200, { ok: true, slug: person.slug, inviteLink: isTestAddress(person.email) ? link : undefined });
  }

  if (p === '/api/people/update') {
    const slug = String(body.slug || '');
    const current = SLUG.test(slug) ? personOf(slug) : null;
    if (!current || !canManagePerson(me.slug, current)) return json(res, 403, { error: 'you cannot manage this person' });
    const profile = body.person && typeof body.person === 'object' && !Array.isArray(body.person)
      ? body.person : {};
    const roles = body.roles;
    if (!validRoleAssignments(me.slug, roles)) return json(res, 400, { error: 'the role or scope is invalid or outside your authority' });
    if (isSuperadmin(slug) && !roles.some(role => role.role === 'superadmin') && lastSuperadmin(slug)) {
      return json(res, 409, { error: 'the last superadmin cannot be demoted' });
    }
    const before = JSON.parse(JSON.stringify(current));
    const next = Object.assign({}, current, {
      name: profile.name === undefined ? current.name : String(profile.name).trim(),
      title: profile.title === undefined ? current.title : String(profile.title).trim(),
      photo: profile.photo === undefined ? current.photo || '' : String(profile.photo),
      faculty: profile.faculty === undefined ? current.faculty : String(profile.faculty).trim(),
      department: profile.department === undefined ? current.department : String(profile.department).trim(),
      roles
    });
    if (next.name.length > 200 || next.title.length > 200 || next.photo.length > 200000
      || next.faculty.length > 200 || next.department.length > 200) {
      return json(res, 400, { error: 'a profile field is too long' });
    }
    if (profile.email !== undefined) {
      const email = String(profile.email).trim().toLowerCase();
      if (!/^[^@\s]+@bau\.edu\.lb$/.test(email)
        || allPeople().some(person => person.slug !== slug && String(person.email || '').toLowerCase() === email)) {
        return json(res, 400, { error: 'use a unique BAU email address' });
      }
      const account = store[acctKey(slug)];
      if (account && email !== String(current.email || '').toLowerCase()) {
        return json(res, 409, { error: 'email changes for an activated account require a new verified invitation' });
      }
      next.email = email;
    }
    store['people/' + slug] = next;
    save();
    const rolesChanged = JSON.stringify(before.roles) !== JSON.stringify(next.roles);
    audit(me.slug, rolesChanged ? 'person-role-changed' : 'person-updated', {
      target: slug, before, after: next, ip
    });
    return json(res, 200, { ok: true, person: next });
  }

  if (p === '/api/people/deactivate') {
    const slug = String(body.slug || '');
    const target = SLUG.test(slug) ? personOf(slug) : null;
    if (!target || !canManagePerson(me.slug, target)) return json(res, 403, { error: 'you cannot manage this person' });
    if (target.active === false) return json(res, 200, { ok: true, active: false });
    if (isSuperadmin(slug) && lastSuperadmin(slug)) {
      return json(res, 409, { error: 'the last superadmin cannot be deactivated' });
    }
    const before = JSON.parse(JSON.stringify(target));
    target.active = false;
    [store._sessions, store._resets, store._verifies].forEach(bag => {
      if (bag) Object.keys(bag).forEach(key => { if (bag[key] && bag[key].slug === slug) delete bag[key]; });
    });
    save();
    audit(me.slug, 'person-deactivated', { target: slug, before, after: target, ip });
    return json(res, 200, { ok: true, active: false });
  }

  if (p === '/api/password') {
    const acct = store[acctKey(me.slug)];
    if (!acct) return json(res, 404, { error: 'no account' });
    const key = 'pw:' + me.slug + ':' + ip;
    if (tooMany(key)) return json(res, 429, { error: 'too many tries, wait a few minutes' });
    if (!sameSecret(await hash(String(body.current || '').slice(0, PASSWORD_MAX), acct.salt), acct.hash)) {
      failed(key);
      return json(res, 401, { error: 'that is not your current password' });
    }
    const next = String(body.next || '');
    const pwBad = passwordProblem(next);
    if (pwBad) return json(res, 400, { error: pwBad });
    cleared(key);
    acct.salt = newSalt();
    acct.hash = await hash(next, acct.salt);
    acct.changedAt = Date.now();
    dropResets(me.slug);
    endSessionsOf(me.slug, me.id);         // keep this session, sign out everywhere else
    save();
    audit(me.slug, 'password-changed', { ip });
    return json(res, 200, { ok: true });
  }

  // ---- records ---------------------------------------------------------------
  // Suggestions. The author slug comes from the session, not the page, so an
  // idea is always tied to whoever was signed in. Saved to the board and
  // emailed to the configured admin recipients when mail is set up.
  if (p === '/api/idea') {
    const text = String(body.text || '').trim().slice(0, 4000);
    const kind = ['idea', 'problem', 'question'].indexOf(String(body.kind)) >= 0 ? String(body.kind) : 'idea';
    if (!text) return json(res, 400, { error: 'write something first' });
    const acct = store[acctKey(me.slug)] || {};
    const id = 'i' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const person = personOf(me.slug);
    const idea = { id, kind, text, slug: me.slug, by: person ? ((person.honorific !== undefined ? person.honorific : 'Dr.') + ' ' + person.name).trim() : me.slug,
      email: acct.email || '', at: Date.now(), votes: [] };
    store['ideas/' + id] = idea;
    save();

    let sent = false;
    const recipients = ideaRecipients();
    if (mail.configured() && recipients) {
      const label = kind === 'problem' ? 'Problem reported' : kind === 'question' ? 'Question' : 'Suggestion';
      const lines = [
        label + ' from the Online Advising System.',
        '',
        'From: ' + idea.by + (acct.email ? ' <' + acct.email + '>' : ''),
        'When: ' + new Date(idea.at).toISOString(),
        '',
        text,
        '',
        'It is also on the suggestions board inside the portal, where the other advisors can',
        'add that they want the same thing.'
      ].join('\n');
      mail.send(recipients, 'Online Advising System: ' + label.toLowerCase() + ' from ' + idea.by, lines)
        .then(() => { idea.emailed = true; save(); })
        .catch(e => console.error('could not send the suggestion:', e.message));
      sent = true;
    }
    return json(res, 200, { ok: true, idea, emailed: sent, to: sent ? recipients : null });
  }

  /* ---- send mail from the portal ----
     Long messages (review lists) do not fit in a mailto: link, so they are sent
     from here. Recipients are limited to university addresses, each advisor
     has a daily cap, and every message is recorded in the audit log.
     Reply-To is the advisor's BAU address. */
  if (p === '/api/send') {
    if (!mail.configured()) return json(res, 503, { error: 'no mailbox is set up on this server yet' });
    const to = String(body.to || '').trim();
    const subject = String(body.subject || '').trim().slice(0, 300);
    const text = String(body.text || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json(res, 400, { error: 'that does not look like an email address' });
    const domain = to.split('@').pop().toLowerCase();
    if (MAIL_DOMAINS.indexOf(domain) < 0) return json(res, 400, { error: 'the portal only sends to university addresses (' + MAIL_DOMAINS.join(', ') + ')' });
    const day = new Date().toISOString().slice(0, 10);
    const sentKey = 'mail:' + me.slug + ':' + day;
    const sentToday = mailCount.get(sentKey) || 0;
    if (sentToday >= MAIL_PER_DAY) return json(res, 429, { error: 'daily sending limit reached; try again tomorrow' });
    if (!text.trim()) return json(res, 400, { error: 'there is nothing to send' });
    if (text.length > 200000) return json(res, 400, { error: 'that message is too long to send' });
    const acct = store[acctKey(me.slug)] || {};
    try {
      await mail.send(to, subject || 'From the Online Advising System', text, acct.email || undefined);
      mailCount.set(sentKey, sentToday + 1);
      audit(me.slug, 'mail-sent', { to, subjectLength: subject.length, bytes: text.length });
      return json(res, 200, { ok: true, to });
    } catch (e) {
      console.error('could not send:', e.message);
      return json(res, 502, { error: 'the mail server did not accept it. Try again later.' });
    }
  }

  /* ---- admin: a reset link to hand to an advisor ----
     For when mail is not set up. The admin forwards the link from their own
     mailbox; it is the same single-use, time-limited link the email carries. */
  if (p === '/api/admin/reset-link') {
    if (!canUser(me.slug, 'people:manage', scopesOf(personOf(String(body.slug || '')))[0])) {
      return json(res, 403, { error: 'you cannot manage this person' });
    }
    const slug = String(body.slug || '');
    if (!SLUG.test(slug) || isSuperadmin(slug)) return json(res, 400, { error: 'unknown advisor' });
    if (!store[acctKey(slug)]) return json(res, 404, { error: 'this advisor has not created an account yet' });
    audit(me.slug, 'admin-reset-link', { advisor: slug, ip });
    return json(res, 200, { ok: true, link: resetLink(req, newResetToken(slug)), minutes: RESET_MINUTES });
  }

  // Admin: clear one advisor's password so they create their account again
  // (and get the activation email). Their students and notes are untouched.
  if (p === '/api/admin/clear-password') {
    const slug = String(body.slug || '');
    const target = SLUG.test(slug) ? personOf(slug) : null;
    if (!target || !canManagePerson(me.slug, target) || isSuperadmin(slug)) {
      return json(res, 403, { error: 'you cannot manage this person' });
    }
    const had = !!store[acctKey(slug)];
    delete store[acctKey(slug)];
    [store._sessions, store._resets, store._verifies].forEach(bag => {
      if (bag) Object.keys(bag).forEach(k => { if (bag[k] && bag[k].slug === slug) delete bag[k]; });
    });
    cleared('su-acct:' + slug); cleared('vres:' + slug);
    save();
    audit(me.slug, 'admin-clear-password', { advisor: slug, ip });
    return json(res, 200, { ok: true, had });
  }

  /* ---- admin: all students ----
     Every advisor's stored list, keyed by slug. */
  if (p === '/api/all-students') {
    if (!canUser(me.slug, 'students:read', scopesOf(personOf(me.slug))[0])) {
      return json(res, 403, { error: 'not yours to read' });
    }
    audit(me.slug, 'read-all-students', { ip });
    const slugs = new Set();
    Object.keys(store).forEach(k => {
      const m = /^advisors\/([a-z0-9-]+)\//.exec(k);
      if (m) slugs.add(m[1]);
    });
    const out = {};
    slugs.forEach(slug => {
      if (!canForOwner(me.slug, slug, 'students:read')) return;
      const prefix = 'advisors/' + slug + '/students/';
      const saved = {};
      Object.keys(store).forEach(k => {
        if (k.startsWith(prefix) && k.slice(prefix.length).indexOf('/') < 0) {
          saved[k.slice(prefix.length)] = store[k];
        }
      });
      const list = Object.values(saved);
      if (list.length) out[slug] = list;
    });
    return json(res, 200, { advisors: out });
  }

  // Atomic import write. An advisor always writes to their own list (the
  // session decides, not the request). Only the admin may name another
  // advisor, to import on their behalf; the records then sit in that
  // advisor's own list and reach their account on the next sync.
  if (p === '/api/students/save') {
    if (!ENABLE_STUDENT_IMPORTS) {
      return json(res, 503, { error: 'student imports are disabled until production storage has been verified' });
    }
    let owner = me.slug;
    if (body.advisor && body.advisor !== me.slug) {
      if (!SLUG.test(String(body.advisor)) || !canForOwner(me.slug, String(body.advisor), 'students:write')) {
        return json(res, 403, { error: 'not yours to change' });
      }
      owner = String(body.advisor);
    }
    const students = Array.isArray(body.students) ? body.students : null;
    if (!students || students.length > 2000) return json(res, 400, { error: 'invalid student import' });
    const seen = new Set();
    for (const student of students) {
      if (!student || typeof student !== 'object' || Array.isArray(student)
          || !/^\d{5,20}$/.test(String(student.id || '')) || seen.has(String(student.id))) {
        return json(res, 400, { error: 'invalid student record' });
      }
      seen.add(String(student.id));
    }
    const prefix = 'advisors/' + owner + '/students/';
    students.forEach(student => {
      cleanStudent(student);
      student.updatedAt = Date.now();
      student.updatedBy = me.slug;
      store[prefix + String(student.id)] = student;
    });
    audit(me.slug, 'students-save', { advisor: owner, count: students.length });
    const metaKey = 'advisors/' + owner + '/meta';
    const meta = store[metaKey] || { removed: [] };
    if (meta.removed && meta.removed.length) {
      meta.removed = meta.removed.filter(id => !seen.has(String(id)));
      store[metaKey] = meta;
    }
    save();
    return json(res, 200, { ok: true, saved: students.length });
  }

  // Start over: remove every imported record of one advisor in one request.
  if (p === '/api/students/clear') {
    if (!ENABLE_STUDENT_IMPORTS) {
      return json(res, 503, { error: 'student record changes are disabled until production storage has been verified' });
    }
    let owner = me.slug;
    if (body.advisor && body.advisor !== me.slug) {
      if (!SLUG.test(String(body.advisor)) || !canForOwner(me.slug, String(body.advisor), 'students:clear')) {
        return json(res, 403, { error: 'not yours to change' });
      }
      owner = String(body.advisor);
    }
    if (!canForOwner(me.slug, owner, 'students:clear')) return json(res, 403, { error: 'not yours to change' });
    const prefix = 'advisors/' + owner + '/students/';
    let n = 0;
    Object.keys(store).forEach(k => { if (k.indexOf(prefix) === 0) { delete store[k]; n++; } });
    store['advisors/' + owner + '/meta'] = { removed: [] };
    save();
    audit(me.slug, 'students-clear', { advisor: owner, count: n });
    return json(res, 200, { ok: true, cleared: n });
  }

  if (p === '/api/get' || p === '/api/list' || p === '/api/set' || p === '/api/delete') {
    const key = String(body.path || '');
    const write = p === '/api/set' || p === '/api/delete';
    if (!mayTouch(me.slug, key, write ? 'write' : 'read')) return json(res, 403, { error: 'not yours to read or change' });
    if ((p === '/api/set' || p === '/api/delete')
        && /^advisors\/[a-z0-9-]+\/students\//.test(key)) {
      if (!ENABLE_STUDENT_IMPORTS) {
        return json(res, 503, { error: 'student record changes are disabled until production storage has been verified' });
      }
      if (!/^advisors\/[a-z0-9-]+\/students\/\d{5,20}$/.test(key)) {
        return json(res, 400, { error: 'invalid student record path' });
      }
    }
    if (p === '/api/get') {
      return json(res, 200, { data: Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null });
    }
    if (p === '/api/list') {
      const prefix = key.replace(/\/+$/, '') + '/';
      const out = {};
      Object.keys(store).forEach(k => {
        if (k.startsWith(prefix) && k.slice(prefix.length).indexOf('/') < 0 && mayTouch(me.slug, k)) {
          out[k.slice(prefix.length)] = store[k];
        }
      });
      return json(res, 200, { data: out });
    }
    // The sign-in cover is superadmin-only and must be an image.
    if ((p === '/api/set' || p === '/api/delete') && key.indexOf('brand/') === 0) {
      if (p === '/api/set' && body.value != null
          && !/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(String(body.value))) {
        return json(res, 400, { error: 'that is not an image' });
      }
    }
    // suggestions: new ones go through /api/idea; an existing one can only be
    // changed (votes, done) without touching its text or author, or removed by its author or the admin
    if ((p === '/api/set' || p === '/api/delete') && key.indexOf('ideas/') === 0) {
      const cur = store[key];
      if (!cur) return json(res, 403, { error: 'post suggestions from the suggestions page' });
      if (p === '/api/delete' && cur.slug !== me.slug && !isSuperadmin(me.slug)) {
        return json(res, 403, { error: 'only the author or the admin can remove it' });
      }
      if (p === '/api/set') {
        const v = body.value && typeof body.value === 'object' ? body.value : {};
        // you can only add or take back your own vote
        const person = personOf(me.slug), mine = person ? person.name : me.slug;
        const want = Array.isArray(v.votes) && v.votes.map(String).includes(mine);
        const votes = (Array.isArray(cur.votes) ? cur.votes : []).filter(x => x !== mine).concat(want ? [mine] : []);
        body.value = Object.assign({}, cur, { votes, done: isSuperadmin(me.slug) ? !!v.done : !!cur.done });
      }
    }
    // a student record must carry the id it is filed under
    if (p === '/api/set' && /^advisors\/[a-z0-9-]+\/students\/[^/]+$/.test(key)) {
      const v = body.value;
      const id = key.split('/').pop();
      if (!/^\d{5,20}$/.test(id) || !v || typeof v !== 'object' || Array.isArray(v) || String(v.id) !== id) {
        return json(res, 400, { error: 'invalid student record' });
      }
    }
    if (p === '/api/set') {
      if (/^advisors\/[a-z0-9-]+\/students\//.test(key)) {
        cleanStudent(body.value);
        body.value.updatedAt = Date.now(); body.value.updatedBy = me.slug;
      }
      store[key] = body.value; save();
      if (!key.startsWith('advisors/' + me.slug + '/') || /\/students\//.test(key) || !key.startsWith('advisors/')) {
        const student = /^advisors\/([a-z0-9-]+)\/students\/\d+$/.exec(key);
        audit(me.slug, 'set', student ? { advisor: student[1], recordType: 'student' } : { key });
      }
      return json(res, 200, { ok: true });
    }
    delete store[key]; save();
    const student = /^advisors\/([a-z0-9-]+)\/students\/\d+$/.exec(key);
    audit(me.slug, 'delete', student ? { advisor: student[1], recordType: 'student' } : { key });
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'not found' });
}

// ---- serving the page ------------------------------------------------------
const CSP = [
  "default-src 'self'",
  // scripts are inlined into the page (pdf.js included), nothing loads from a CDN
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join('; ');

/* CSRF: POSTs must come from our own pages. SameSite=Lax on the cookie
   already blocks cross-site forms, this Origin check is the second layer in
   case one of them has a gap. No Origin at all (curl, health probe) is let
   through since those don't carry a cookie anyway. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch (e) { return false; }
}

/* Per-ip limit on the auth routes, across all accounts. The per-account
   counter catches someone hammering one login, this catches someone trying
   every account. Memory only on purpose, it's a speed bump, not a log. */
const byAddress = new Map();
function tooManyFrom(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const window = 15 * 60 * 1000;
  const rec = byAddress.get(ip) || { hits: [], };
  rec.hits = rec.hits.filter(t => now - t < window);
  rec.hits.push(now);
  byAddress.set(ip, rec);
  if (byAddress.size > 5000) byAddress.clear();     // crude cap so the map can't grow forever
  return rec.hits.length > 60;
}

function securityHeaders(req) {
  const h = {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'permissions-policy': 'geolocation=(), microphone=(), camera=()',
    'cross-origin-opener-policy': 'same-origin'
  };
  if (isHttps(req)) h['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

/* Student records are never embedded in the served page and are supplied only
   by the authenticated server-side store. */
let servedPage = null, servedFrom = 0;
function pageForWire() {
  const stat = fs.statSync(PAGE);
  if (servedPage && servedFrom === stat.mtimeMs) return servedPage;
  const html = fs.readFileSync(PAGE, 'utf8')
    .replace('<head>', '<head><script>window.SERVED=true;</script>');
  servedPage = Buffer.from(html, 'utf8');
  servedFrom = stat.mtimeMs;
  return servedPage;
}

// Health: the page exists and the data folder is writable.
async function healthy() {
  if (storageFailure) return false;
  try {
    fs.accessSync(PAGE, fs.constants.R_OK);
    if (databaseStore) await databaseStore.check();
    else {
      if (PRODUCTION && !STORE_KEY) return false;
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.accessSync(DATA_DIR, fs.constants.W_OK);
    }
    return true;
  } catch (e) { return false; }
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400).end(); return; }
  const p = url.pathname;

  if (p === '/health') {
    const ok = await healthy();
    return json(res, ok ? 200 : 503, { ok, mail: mail.configured() });
  }

  if (p.startsWith('/api/')) {
    try { return await api(req, res, url); }
    catch (e) { console.error('api error:', e.message); return json(res, 500, { error: 'something went wrong' }); }
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    let buf;
    try { buf = pageForWire(); }
    catch (e) {
      res.writeHead(500, Object.assign({ 'content-type': 'text/plain' }, securityHeaders(req)));
      res.end('build/index.html is missing. Run "node build.js" before starting the server.');
      return;
    }
    res.writeHead(200, Object.assign({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }, securityHeaders(req)));
    res.end(req.method === 'HEAD' ? null : buf);
    return;
  }
  json(res, 405, { error: 'method not allowed' });
});

async function startServer() {
  if (PRODUCTION && ALLOW_UNVERIFIED_SIGNUP) {
    throw new Error('ALLOW_UNVERIFIED_SIGNUP=true is not allowed in production');
  }
  if (PRODUCTION && !process.env.DATABASE_URL && !STORE_KEY) {
    throw new Error('DATABASE_URL or STORE_KEY is required in production; refusing to start with unencrypted file storage');
  }
  if (process.env.DATABASE_URL) {
    databaseStore = new PostgresStore(createPool(), error => {
      storageFailure = error;
      console.error('PostgreSQL connection error:', error.code || 'unexpected client error');
      if (server.listening) {
        process.exitCode = 1;
        shutdown('PostgreSQL connection error');
      }
    });
    store = await databaseStore.load();
    await databaseStore.check();
    if (fs.existsSync(DATA_FILE) && Object.keys(loadStore()).length) {
      throw new Error('A legacy JSON store exists on the mounted volume; preserve it and complete a verified migration before starting');
    }
  } else {
    if (PRODUCTION && !STORE_KEY) throw new Error('PostgreSQL or encrypted file storage is required in production');
    store = loadStore();
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const beforeTree = store['org/tree'] || null;
  const migration = OrgTree.migrateStore(store, LEGACY_FACULTY, MIGRATION_ADMIN_SLUGS);
  if (migration.changed) {
    save();
    audit('system', 'org-migration', {
      before: { tree: beforeTree, people: [] },
      after: { tree: store['org/tree'], importedPeople: migration.importedPeople }
    });
    await flushStore();
  }

  sweepSessions();
  server.listen(PORT, () => {
    console.log('Online Advising System on port ' + PORT);
    console.log('  storage: ' + (databaseStore ? 'PostgreSQL' : STORE_KEY ? 'encrypted files (AES-256-GCM)' : 'local development files'));
    console.log('  bootstrap superadmins: ' + (BOOTSTRAP_SUPERADMINS.join(', ') || 'none'));
    console.log('  sign-up ' + (ALLOW_SIGNUP ? 'open' : 'closed') + ', sessions ' + SESSION_HOURS + 'h (idle ' + SESSION_IDLE_MINUTES + ' min)');
    console.log('  email: ' + (mail.configured() ? 'on' : 'off') + ', public URL: ' + (PUBLIC_URL || 'not set'));
    if (!mail.configured() || !PUBLIC_URL) {
      console.warn('  WARNING: email or PUBLIC_URL missing: new accounts cannot be verified'
        + (ALLOW_UNVERIFIED_SIGNUP ? ' (ALLOW_UNVERIFIED_SIGNUP is on: development only)' : ', so sign-up is closed'));
    }
  });
}

startServer().catch(async error => {
  console.error('Startup failed:', error.code || error.message);
  if (databaseStore) await databaseStore.close().catch(() => {});
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(signal + ' received, shutting down');
  const timeout = setTimeout(() => {
    console.error('Shutdown timed out before storage flush completed');
    process.exit(1);
  }, 10000);
  timeout.unref();
  server.close(async () => {
    try {
      await flushStore();
      if (databaseStore) await databaseStore.close();
      clearTimeout(timeout);
    } catch (e) {
      console.error('Shutdown storage flush failed:', e.code || e.message);
      process.exitCode = 1;
    }
  });
}
['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => shutdown(sig)));
process.on('unhandledRejection', e => {
  console.error('unhandled rejection:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
  shutdown('unhandled rejection');
});
