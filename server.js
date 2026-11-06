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
const VolumeMigration = require('./src/volume-migration');
const OrgTree = require('./src/org-tree');
const Permissions = require('./src/permissions');
const Programme = require('./src/programme');
const SHARED_CATALOG = require('./data/catalog.json');

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
// one-time move of the volume store into PostgreSQL (src/volume-migration.js)
const MIGRATE_FROM_VOLUME = /^(1|true|yes)$/i.test(String(process.env.MIGRATE_FROM_VOLUME || ''));
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
// Load BAU's faculties, programmes and catalogue study plans once at start-up
// (on by default on the deployed server, off for local development and tests).
const SEED_CATALOGUE = boolEnv('SEED_CATALOGUE', PRODUCTION);
/* A dedicated superadmin account that is nobody's personal account. Its
   address may be outside bau.edu.lb (for example the project's own mailbox);
   it is the only such address the server accepts.
   It defaults to the advising desk's own mailbox; SUPERADMIN_EMAIL=none turns
   the account off. */
const SUPERADMIN_EMAIL = (raw => (raw === 'none' || raw === 'off' ? '' : raw))(
  String(process.env.SUPERADMIN_EMAIL || 'bau.advisingdesk@gmail.com').trim().toLowerCase());
/* Staff sign in with a university address. STAFF_EMAIL_DOMAINS lets another
   university (or a second domain) use the portal without code changes. */
const STAFF_EMAIL_DOMAINS = String(process.env.STAFF_EMAIL_DOMAINS || 'bau.edu.lb')
  .split(',').map(d => d.trim().toLowerCase()).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
const universityEmail = email => {
  const m = /^[^@\s]+@([^@\s]+)$/.exec(String(email || '').trim().toLowerCase());
  return !!m && STAFF_EMAIL_DOMAINS.includes(m[1]);
};
const staffEmailOk = email => {
  const e = String(email || '').trim().toLowerCase();
  return universityEmail(e) || (!!SUPERADMIN_EMAIL && e === SUPERADMIN_EMAIL);
};
/* People who must hold only advising roles after the next start-up (a
   one-time correction; later changes made on the People page are kept). */
const ADVISOR_ONLY_EMAILS = String(process.env.ADVISOR_ONLY_EMAILS || 'j.budaher@bau.edu.lb')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
/* The whole system is administered by one account, "BAU Superadmin"
   (SUPERADMIN_EMAIL). Staff listed in RETIRE_STAFF_EMAILS are deactivated
   once, at start-up, as soon as that account is activated: their records are
   kept, their sign-in and sessions end. */
const SUPERADMIN_NAME = 'BAU Superadmin';
const RETIRE_STAFF_EMAILS = String(process.env.RETIRE_STAFF_EMAILS == null ? 'l.arwadi@bau.edu.lb' : process.env.RETIRE_STAFF_EMAILS)
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const STARTED_AT = Date.now();

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

/* A role assignment is split into (role, scope) pairs so that an admin only
   ever touches the pairs inside their own authority. Pairs outside it are kept
   exactly as they are, whatever the request sends. */
function rolePairs(roles) {
  const out = [];
  (Array.isArray(roles) ? roles : []).forEach(assignment => {
    if (!assignment) return;
    (Array.isArray(assignment.scopes) ? assignment.scopes : []).forEach(scope =>
      out.push({ role: assignment.role, scope }));
  });
  return out;
}
function groupPairs(pairs) {
  const byRole = new Map();
  pairs.forEach(pair => {
    if (!byRole.has(pair.role)) byRole.set(pair.role, []);
    const scopes = byRole.get(pair.role);
    if (!scopes.includes(pair.scope)) scopes.push(pair.scope);
  });
  return Array.from(byRole, ([role, scopes]) => ({ role, scopes }));
}
function managesPair(actorSlug, pair) {
  if (isSuperadmin(actorSlug)) return true;
  if (pair.role === 'superadmin') return false;
  return canUser(actorSlug, 'people:manage', pair.scope);
}
function managesAllOf(actorSlug, target) {
  if (isSuperadmin(actorSlug)) return true;
  if (!target || isSuperadmin(target.slug)) return false;
  const pairs = rolePairs(target.roles);
  return pairs.length > 0 && pairs.every(pair => managesPair(actorSlug, pair));
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
  if (!SLUG.test(slug) || !universityEmail(email)) return null;
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
  rememberActivity(entry);
  save();
}

/* The full audit log is append-only (the database role cannot even read it
   back), so the admin dashboard reads a short summary kept in the store: the
   last ACTIVITY_KEEP events, without record contents. */
const ACTIVITY_KEEP = 600;
const QUIET_ACTIONS = new Set(['read-all-students']);
function rememberActivity(entry) {
  if (QUIET_ACTIONS.has(entry.action)) return;
  const d = entry.details || {};
  const list = Array.isArray(store._activity) ? store._activity : (store._activity = []);
  list.push({
    at: entry.at, actor: entry.actor, action: entry.action,
    target: typeof d.target === 'string' ? d.target : typeof d.advisor === 'string' ? d.advisor : undefined,
    key: typeof d.key === 'string' ? d.key.slice(0, 120) : undefined,
    count: Number.isFinite(d.count) ? d.count : undefined,
    ip: typeof d.ip === 'string' ? d.ip : undefined
  });
  if (list.length > ACTIVITY_KEEP) list.splice(0, list.length - ACTIVITY_KEEP);
}

/* Runtime switches a superadmin changes from the dashboard, without a deploy:
   a banner shown to everyone, and read-only mode (only superadmins can change
   anything, for example while the semester is being set up). */
function settings() {
  const s = store._settings && typeof store._settings === 'object' ? store._settings : {};
  return { banner: String(s.banner || ''), bannerTone: s.bannerTone === 'warn' ? 'warn' : 'info', readOnly: !!s.readOnly };
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
    // only the keys the portal uses: an advisor cannot create arbitrary records
    if (!/^advisors\/[a-z0-9-]+\/(students(\/[^/]+)?|meta|settings)$/.test(key)) return false;
    if (/^advisors\/[a-z0-9-]+\/students\//.test(key)) {
      return canForOwner(slug, owner, write ? 'students:write' : 'students:read');
    }
    return owner === slug || (canForOwner(slug, owner, 'students:read')
      && scopesOf(personOf(owner)).some(scope => canUser(slug, 'students:clear', scope)));
  }
  const plan = /^programmes\/([a-z0-9-]+)\/catalog$/.exec(key);
  if (plan) {
    if (OrgTree.findNode(store['org/tree'] || OrgTree.DEFAULT_TREE, plan[1]) === null) return false;
    return canUser(slug, write ? 'rules:write' : 'rules:read', plan[1]);
  }
  const rule = /^config\/([a-z0-9-]+)\/rules$/.exec(key);
  if (rule) return canUser(slug, write ? 'rules:write' : 'rules:read', rule[1]);
  if (key.indexOf('offering/') === 0) return canUser(slug, write ? 'offering:write' : 'offering:read');
  if (key.indexOf('brand/') === 0) return canUser(slug, write ? 'brand:write' : 'brand:read');
  if (key === 'ideas') return !write && canUser(slug, 'ideas:read');
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
    const conf = settings();
    return json(res, 200, {
      slug: s ? s.slug : null, admin: !!(s && isSuperadmin(s.slug)),
      signupAllowed: ALLOW_SIGNUP, mail: mail.configured(),
      banner: s ? conf.banner : '', bannerTone: conf.bannerTone, readOnly: !!s && conf.readOnly
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
    if (!staffEmailOk(email)) {
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
    /* Someone on the staff list who has no working account yet (the original
       doctors never finished sign-up) gets a set-up link instead of a reset
       link. It goes only to the BAU address on file, so it proves the same
       thing an invitation does: they can read that mailbox. */
    if (person && person.active !== false && (!acct || !isVerified(acct)) && canVerify()
        && staffEmailOk(person.email)) {
      if (acct) delete store[acctKey(slug)];      // an old sign-up that was never confirmed
      const link = invitationLink(req, slug, 'invite');
      sendInviteEmail(person, link)
        .catch(e => console.error('could not send the set-up email:', e.message));
      save();
      audit(slug, 'setup-link-requested', { ip });
      return json(res, 200, { ok: true, mail: true });
    }
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
    return json(res, 200, { ok: true, slug, admin: isSuperadmin(slug) },
      { 'set-cookie': cookieFor(newSession(slug), secure) });
  }

  // ---- everything below needs a session ----
  const me = sessionOf(req);
  if (!me) return json(res, 401, { error: 'please sign in' });
  if (!personOf(me.slug) || personOf(me.slug).active === false) {
    endSession(req);
    return json(res, 401, { error: 'this account is no longer active' });
  }

  // Read-only mode: only superadmins may change anything.
  if (settings().readOnly && !isSuperadmin(me.slug)) {
    const changes = p === '/api/set' || p === '/api/delete' || p === '/api/students/save'
      || p === '/api/students/clear' || p.indexOf('/api/people/') === 0 && p !== '/api/people/list'
      || (p === '/api/org/tree' && body.tree !== undefined);
    if (changes) return json(res, 423, { error: 'the portal is read-only for now while it is being set up. Try again later' });
  }

  if (p.indexOf('/api/admin/') === 0 && !['/api/admin/reset-link', '/api/admin/clear-password'].includes(p)) {
    if (!isSuperadmin(me.slug)) return json(res, 403, { error: 'only a superadmin can open the admin dashboard' });
    return adminApi(p, body, req, res, me, ip);
  }

  if (p === '/api/org/tree') {
    if (body.tree === undefined) return json(res, 200, { tree: store['org/tree'] || OrgTree.DEFAULT_TREE });
    const current = store['org/tree'] || OrgTree.DEFAULT_TREE;
    // a faculty admin may reshape the inside of their own faculty, nothing else
    const own = isSuperadmin(me.slug) ? null : ((personOf(me.slug) || {}).roles || [])
      .filter(a => a && a.role === 'faculty-admin').flatMap(a => a.scopes || []);
    if (own && !own.length) return json(res, 403, { error: 'only a superadmin or a faculty admin can change the organisation tree' });
    const result = OrgTree.validateTree(body.tree);
    if (!result.ok) return json(res, 400, { error: result.error });
    if (own) {
      const outside = t => JSON.stringify(Object.assign({}, t, {
        faculties: (t.faculties || []).map(f => own.includes(f.id) ? { id: f.id } : f) }));
      if (outside(current) !== outside(body.tree)) {
        return json(res, 403, { error: 'you can only change departments and programmes inside your own faculty' });
      }
    }
    const withPlan = Object.keys(store).map(k => /^programmes\/([a-z0-9-]+)\/catalog$/.exec(k)).filter(Boolean).map(m => m[1]);
    const lost = withPlan.filter(id => !OrgTree.findNode(body.tree, id));
    if (lost.length) {
      return json(res, 409, { error: 'a programme that already has a study plan cannot be removed: ' + lost.join(', ') });
    }
    if (!OrgTree.findNode(body.tree, 'cs')) return json(res, 409, { error: 'the Computer Science programme cannot be removed' });
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
    if (!isSuperadmin(me.slug) && !scopesOf(personOf(me.slug)).some(scope => canUser(me.slug, 'people:read', scope))) {
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

  /* Invite someone who is already on the staff list but has no working
     account yet (for example a doctor from the original list who never signed
     up). A new single-use link is emailed to their BAU address. A superadmin
     also gets the link back, to hand over when email is not set up. */
  if (p === '/api/people/reinvite') {
    const slug = String(body.slug || '');
    const target = SLUG.test(slug) ? personOf(slug) : null;
    if (!target || !store['people/' + slug] || !canManagePerson(me.slug, target) || me.slug === slug) {
      return json(res, 403, { error: 'you cannot manage this person' });
    }
    if (target.active === false) return json(res, 409, { error: 'this person is deactivated' });
    if (!staffEmailOk(target.email)) return json(res, 400, { error: 'this person has no BAU email address on file' });
    const acct = store[acctKey(slug)];
    if (acct && isVerified(acct)) return json(res, 409, { error: 'this person already has an account; use a password reset instead' });
    if (acct) delete store[acctKey(slug)];        // an old sign-up that was never confirmed
    const link = invitationLink(req, slug, 'invite');
    let emailed = false;
    if (!isTestAddress(target.email) && canVerify()) {
      try { await sendInviteEmail(target, link); emailed = true; }
      catch (e) { console.error('could not send the invitation email:', e.message); }
    } else if (isTestAddress(target.email) || !PRODUCTION) {
      console.log('Invitation for ' + target.email + ': ' + link);
    }
    save();
    audit(me.slug, 'person-reinvited', { target: slug, emailed, ip });
    const showLink = isSuperadmin(me.slug) || isTestAddress(target.email);
    if (!emailed && !showLink) return json(res, 502, { error: 'the invitation email could not be sent' });
    return json(res, 200, { ok: true, emailed, email: target.email, link: showLink ? link : undefined, hours: VERIFY_HOURS });
  }

  if (p === '/api/people/update') {
    const slug = String(body.slug || '');
    const current = SLUG.test(slug) ? personOf(slug) : null;
    if (!current || !canManagePerson(me.slug, current)) return json(res, 403, { error: 'you cannot manage this person' });
    const profile = body.person && typeof body.person === 'object' && !Array.isArray(body.person)
      ? body.person : {};
    // roles outside the caller's authority are kept; only in-scope roles change
    const kept = rolePairs(current.roles).filter(pair => !managesPair(me.slug, pair));
    const wanted = body.roles === undefined ? rolePairs(current.roles).filter(pair => managesPair(me.slug, pair))
      : rolePairs(body.roles).filter(pair => managesPair(me.slug, pair));
    const wantedRoles = groupPairs(wanted);
    if (!Array.isArray(body.roles === undefined ? [] : body.roles)
      || (wantedRoles.length && !validRoleAssignments(me.slug, wantedRoles))) {
      return json(res, 400, { error: 'the role or scope is invalid or outside your authority' });
    }
    const roles = groupPairs(kept.concat(wanted));
    if (!roles.length) return json(res, 400, { error: 'a person needs at least one role; deactivate them instead' });
    const profileKeys = ['name', 'title', 'photo', 'faculty', 'department', 'email'];
    const profileChanged = profileKeys.some(k => profile[k] !== undefined
      && String(profile[k]).trim() !== String(current[k] || '').trim());
    if (profileChanged && me.slug !== slug && !managesAllOf(me.slug, current)) {
      return json(res, 403, { error: 'this person also works outside your scope, so only their roles in your scope can be changed' });
    }
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
      if (!staffEmailOk(email)
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
    if (!managesAllOf(me.slug, target)) {
      // they also work elsewhere: take away only the roles in the caller's scope
      const kept = rolePairs(target.roles).filter(pair => !managesPair(me.slug, pair));
      if (kept.length === rolePairs(target.roles).length) return json(res, 403, { error: 'you cannot manage this person' });
      target.roles = groupPairs(kept);
      save();
      audit(me.slug, 'person-role-changed', { target: slug, before, after: target, ip });
      return json(res, 200, { ok: true, active: true, rolesRemoved: true });
    }
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
    // A reset link hands over the account, so the caller must manage every
    // role this person holds, not just one of them.
    const slug = String(body.slug || '');
    const target = SLUG.test(slug) ? personOf(slug) : null;
    if (!target || slug === me.slug || !managesAllOf(me.slug, target)) {
      return json(res, 403, { error: 'you cannot manage this person' });
    }
    if (isSuperadmin(slug)) return json(res, 400, { error: 'unknown advisor' });
    if (!store[acctKey(slug)]) return json(res, 404, { error: 'this advisor has not created an account yet' });
    audit(me.slug, 'admin-reset-link', { advisor: slug, ip });
    return json(res, 200, { ok: true, link: resetLink(req, newResetToken(slug)), minutes: RESET_MINUTES });
  }

  // Admin: clear one advisor's password so they create their account again
  // (and get the activation email). Their students and notes are untouched.
  if (p === '/api/admin/clear-password') {
    const slug = String(body.slug || '');
    const target = SLUG.test(slug) ? personOf(slug) : null;
    if (!target || slug === me.slug || !managesAllOf(me.slug, target) || isSuperadmin(slug)) {
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
    // a programme's study plan is checked before it is kept: a broken one would
    // give every student in that programme wrong advice
    const planKey = /^programmes\/([a-z0-9-]+)\/catalog$/.exec(key);
    if (planKey && p === '/api/delete') {
      return json(res, 409, { error: 'a study plan cannot be deleted; remove the programme from the structure instead' });
    }
    if (planKey && p === '/api/set') {
      const v = body.value;
      if (!v || typeof v !== 'object' || Array.isArray(v) || JSON.stringify(v).length > 2 * 1024 * 1024) {
        return json(res, 400, { error: 'invalid study plan' });
      }
      const known = SHARED_CATALOG.universityElectives.map(c => c.code)
        .concat(SHARED_CATALOG.genScienceElectives.map(c => c.code), SHARED_CATALOG.courses.map(c => c.code));
      Object.keys(store).forEach(k => {
        if (/^programmes\/[a-z0-9-]+\/catalog$/.test(k) && store[k] && Array.isArray(store[k].courses)) {
          store[k].courses.forEach(c => known.push(c.code));
        }
      });
      const check = Programme.validate(v, known);
      if (check.errors.length) return json(res, 400, { error: 'the study plan has problems: ' + check.errors.slice(0, 5).join(' '), problems: check.errors });
      const before = store[key] || null;
      body.value = Programme.forStorage(v);
      body.value.updatedAt = Date.now(); body.value.updatedBy = me.slug;
      store[key] = body.value; save();
      audit(me.slug, 'study-plan-saved', { programme: planKey[1], created: !before,
        courses: body.value.courses.length, totalCredits: body.value.totalCredits, ip });
      return json(res, 200, { ok: true, warnings: check.warnings });
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
      // size caps per kind of record, so one account cannot fill the database
      const size = JSON.stringify(body.value === undefined ? null : body.value).length;
      const cap = key.indexOf('offering/') === 0 ? 20 * 1024 * 1024
        : /^(brand\/|programmes\/|config\/)/.test(key) ? 6 * 1024 * 1024
        : /\/students\/\d+$/.test(key) ? 4 * 1024 * 1024
        : 512 * 1024;
      if (size > cap) return json(res, 413, { error: 'that record is too large' });
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

// ---- admin dashboard (superadmin only; checked by the caller) --------------
function studentCounts() {
  const byAdvisor = {};
  Object.keys(store).forEach(k => {
    const m = /^advisors\/([a-z0-9-]+)\/students\/[^/]+$/.exec(k);
    if (m) byAdvisor[m[1]] = (byAdvisor[m[1]] || 0) + 1;
  });
  return byAdvisor;
}

function adminOverview() {
  const tree = store['org/tree'] || OrgTree.DEFAULT_TREE;
  const people = allPeople();
  const byAdvisor = studentCounts();
  const roleCounts = {};
  people.forEach(person => (person.roles || []).forEach(r => {
    if (r && r.role) roleCounts[r.role] = (roleCounts[r.role] || 0) + 1;
  }));
  const accountOf = person => store[acctKey(person.slug)];
  const sessionList = Object.values(sessions()).filter(rec => rec && !sessionExpired(rec));
  const onlineBy = {};
  sessionList.forEach(rec => {
    const cur = onlineBy[rec.slug];
    if (!cur || (rec.seen || rec.at) > cur.seen) onlineBy[rec.slug] = { seen: rec.seen || rec.at, at: rec.at, n: (cur ? cur.n : 0) + 1 };
    else cur.n += 1;
  });

  // one row per programme: who advises it, how many students, is it set up
  const programmes = [];
  (tree.faculties || []).forEach(faculty => (faculty.departments || []).forEach(department =>
    (department.programmes || []).forEach(programme => {
      const advisors = people.filter(person => person.active !== false && (person.roles || [])
        .some(r => r && r.role === 'advisor' && (r.scopes || []).includes(programme.id)));
      const plan = store['programmes/' + programme.id + '/catalog'];
      const hasRules = !!store['config/' + programme.id + '/rules'];
      programmes.push({
        id: programme.id, name: programme.name, faculty: faculty.name, department: department.name,
        campuses: Array.isArray(programme.campuses) ? programme.campuses : [],
        advisors: advisors.length,
        students: advisors.reduce((n, person) => n + (byAdvisor[person.slug] || 0), 0),
        plan: programme.id === 'cs' && !plan ? 'built-in' : !plan ? 'missing'
          : plan.setupStatus === 'ready' ? 'ready' : 'to check',
        rules: hasRules ? 'own' : 'university'
      });
    })));

  const day = Date.now() - 24 * 3600e3, week = Date.now() - 7 * 24 * 3600e3;
  const activity = Array.isArray(store._activity) ? store._activity : [];
  const since = (t, action) => activity.filter(a => a.action === action && Date.parse(a.at) >= t).length;
  const mem = process.memoryUsage();
  let approxBytes = 0;
  try { approxBytes = Buffer.byteLength(JSON.stringify(store)); } catch (e) { /* too big to measure */ }

  return {
    generatedAt: new Date().toISOString(),
    people: {
      total: people.length,
      active: people.filter(person => person.active !== false).length,
      deactivated: people.filter(person => person.active === false).length,
      withAccount: people.filter(person => accountOf(person) && isVerified(accountOf(person))).length,
      invitePending: people.filter(person => person.active !== false && !(accountOf(person) && isVerified(accountOf(person)))).length,
      roles: roleCounts,
      list: people.map(person => ({
        slug: person.slug, name: person.name, email: person.email, active: person.active !== false,
        roles: (person.roles || []).map(r => ({ role: r.role, scopes: r.scopes || [] })),
        verified: !!(accountOf(person) && isVerified(accountOf(person))),
        lastSignIn: (accountOf(person) || {}).lastSignIn || null,
        students: byAdvisor[person.slug] || 0,
        online: onlineBy[person.slug] || null
      }))
    },
    students: { total: Object.values(byAdvisor).reduce((a, b) => a + b, 0), advisorsWithStudents: Object.keys(byAdvisor).length },
    structure: {
      faculties: (tree.faculties || []).length,
      departments: (tree.faculties || []).reduce((n, f) => n + (f.departments || []).length, 0),
      programmes: programmes.length,
      list: programmes
    },
    security: {
      signinsToday: since(day, 'signin'),
      failedToday: since(day, 'signin-failed'),
      failedWeek: since(week, 'signin-failed'),
      lockedOut: Array.from(attempts.values()).filter(a => a.until > Date.now()).length,
      activeSessions: sessionList.length,
      passwordResetsWeek: since(week, 'password-reset')
    },
    system: {
      storage: databaseStore ? 'PostgreSQL' : STORE_KEY ? 'Encrypted files' : 'Local files (development)',
      storageOk: !storageFailure,
      mail: mail.configured(), publicUrl: !!PUBLIC_URL, production: PRODUCTION,
      imports: ENABLE_STUDENT_IMPORTS,
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      node: process.version,
      memoryMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576),
      records: Object.keys(store).length, dataMb: Math.round(approxBytes / 104857.6) / 10,
      sessionHours: SESSION_HOURS, idleMinutes: SESSION_IDLE_MINUTES,
      staffDomains: STAFF_EMAIL_DOMAINS, superadminEmail: SUPERADMIN_EMAIL || null
    },
    settings: settings()
  };
}

async function adminApi(p, body, req, res, me, ip) {
  if (p === '/api/admin/overview') return json(res, 200, adminOverview());

  if (p === '/api/admin/activity') {
    const limit = Math.max(1, Math.min(ACTIVITY_KEEP, Number(body.limit) || 200));
    const action = typeof body.action === 'string' ? body.action : '';
    const actor = typeof body.actor === 'string' ? body.actor : '';
    const list = (Array.isArray(store._activity) ? store._activity : [])
      .filter(a => (!action || a.action === action) && (!actor || a.actor === actor || a.target === actor))
      .slice(-limit).reverse();
    return json(res, 200, { events: list });
  }

  if (p === '/api/admin/sessions/end') {
    const all = body.all === true;
    const slug = String(body.slug || '');
    if (!all && !SLUG.test(slug)) return json(res, 400, { error: 'say whose sessions to end' });
    const s = sessions();
    const mine = sessionOf(req);
    let ended = 0;
    Object.keys(s).forEach(k => {
      if (!s[k] || (mine && k === mine.id)) return;      // never your own current session
      if (all || s[k].slug === slug) { delete s[k]; ended++; }
    });
    save();
    audit(me.slug, all ? 'sessions-ended-all' : 'sessions-ended', { target: all ? undefined : slug, count: ended, ip });
    return json(res, 200, { ok: true, ended });
  }

  if (p === '/api/admin/settings') {
    const cur = settings();
    if (body.banner === undefined && body.readOnly === undefined && body.bannerTone === undefined) return json(res, 200, cur);
    const next = {
      banner: body.banner === undefined ? cur.banner : String(body.banner).trim().slice(0, 300),
      bannerTone: body.bannerTone === undefined ? cur.bannerTone : body.bannerTone === 'warn' ? 'warn' : 'info',
      readOnly: body.readOnly === undefined ? cur.readOnly : body.readOnly === true
    };
    store._settings = next;
    save();
    audit(me.slug, 'settings-changed', { before: cur, after: next, ip });
    return json(res, 200, next);
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
  // staff photos on the sign-in directory are the ones published on www.bau.edu.lb
  "img-src 'self' data: blob: https://www.bau.edu.lb",
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
  // cap the map without wiping everyone's counters (a full clear would let an
  // attacker reset their own limit by spraying addresses): drop stale ones first
  if (byAddress.size > 5000) {
    byAddress.forEach((r, k) => { if (!r.hits.some(t => now - t < window)) byAddress.delete(k); });
    if (byAddress.size > 5000) Array.from(byAddress.keys()).slice(0, 1000).forEach(k => byAddress.delete(k));
  }
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

const server = http.createServer({ headersTimeout: 20e3, requestTimeout: 120e3, connectionsCheckingInterval: 5e3 }, async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400).end(); return; }
  const p = url.pathname;

  if (p === '/health') {
    const ok = await healthy();
    return json(res, ok ? 200 : 503, { ok, mail: mail.configured() });
  }

  if (p.startsWith('/api/')) {
    if (apiFlood(clientIp(req))) {
      return json(res, 429, { error: 'too many requests from this connection; wait a minute' }, { 'retry-after': '60' });
    }
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

/* Slow or stuck clients must not hold connections open for ever (slowloris).
   keepAliveTimeout stays above the proxy's idle timeout so the proxy never
   reuses a connection we just closed. */
server.headersTimeout = 20e3;
server.requestTimeout = 120e3;      // a 40 MB import over a slow connection still fits
server.keepAliveTimeout = 65e3;
server.maxHeadersCount = 100;

/* General API limit per address, on top of the sign-in limits: a fixed
   one-minute window. Generous for people, stops scripts hammering the API. */
const API_PER_MINUTE = numberEnv('API_PER_MINUTE', 600, 30, 100000);
const apiHits = new Map();
function apiFlood(ip) {
  const minute = Math.floor(Date.now() / 60e3);
  const rec = apiHits.get(ip);
  if (!rec || rec.minute !== minute) { apiHits.set(ip, { minute, n: 1 }); return false; }
  rec.n += 1;
  return rec.n > API_PER_MINUTE;
}
setInterval(() => {
  const minute = Math.floor(Date.now() / 60e3);
  apiHits.forEach((rec, ip) => { if (rec.minute < minute) apiHits.delete(ip); });
}, 60e3).unref();

// Creates the dedicated superadmin's staff record once, from SUPERADMIN_EMAIL.
// Its password is set through "first time here?" on the sign-in page, which
// emails a set-up link to that address.
function ensureSuperadminAccount() {
  if (!SUPERADMIN_EMAIL) return;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(SUPERADMIN_EMAIL)) { console.warn('SUPERADMIN_EMAIL is not an email address; ignored'); return; }
  const have = findPersonByEmail(SUPERADMIN_EMAIL);
  if (have) {
    if (!isSuperadmin(have.slug)) console.warn('SUPERADMIN_EMAIL belongs to ' + have.slug + ', who is not a superadmin; left unchanged');
    return;
  }
  let slug = 'system-admin', n = 2;
  while (store['people/' + slug]) slug = 'system-admin-' + n++;
  store['people/' + slug] = {
    slug, name: SUPERADMIN_NAME, honorific: '', title: 'System administrator', email: SUPERADMIN_EMAIL,
    photo: '', faculty: '', department: '', short: SUPERADMIN_NAME, rank: '',
    active: true, verified: false, roles: [{ role: 'superadmin', scopes: ['bau'] }]
  };
  save();
  audit('system', 'superadmin-account-created', { target: slug });
  console.log('  created the superadmin staff record ' + slug + ' for ' + SUPERADMIN_EMAIL);
}

/* One-time hand-over to the BAU Superadmin account: the account created as
   "Superadmin" takes its full name, and the RETIRE_STAFF_EMAILS people are
   deactivated. The hand-over waits until the account has a password, so the
   portal is never left without someone who can sign in as superadmin. */
function applyBauSuperadminOnce() {
  const marks = store._seeds || (store._seeds = {});
  const keeper = SUPERADMIN_EMAIL && findPersonByEmail(SUPERADMIN_EMAIL);
  if (!keeper || keeper.active === false || !isSuperadmin(keeper.slug)) return;
  if (!marks['bau-superadmin-name-2026-11']) {
    if (!keeper.name || keeper.name === 'Superadmin') {
      const before = JSON.parse(JSON.stringify(keeper));
      keeper.name = SUPERADMIN_NAME; keeper.short = SUPERADMIN_NAME;
      audit('system', 'person-updated', { target: keeper.slug, before, after: keeper, reason: 'superadmin account name' });
    }
    marks['bau-superadmin-name-2026-11'] = { at: Date.now() };
    save();
  }
  if (marks['retire-staff-2026-11']) return;
  const account = store[acctKey(keeper.slug)];
  if (!account || !account.hash) {
    if (RETIRE_STAFF_EMAILS.length) console.warn('  ' + SUPERADMIN_NAME + ' has not set a password yet; other admin accounts stay active until it does');
    return;
  }
  const retired = [];
  RETIRE_STAFF_EMAILS.forEach(email => {
    const person = findPersonByEmail(email);
    if (!person || person.slug === keeper.slug || person.active === false) return;
    const before = JSON.parse(JSON.stringify(person));
    person.active = false;
    [store._sessions, store._resets, store._verifies].forEach(bag => {
      if (bag) Object.keys(bag).forEach(key => { if (bag[key] && bag[key].slug === person.slug) delete bag[key]; });
    });
    retired.push(person.slug);
    audit('system', 'person-deactivated', { target: person.slug, before, after: person, reason: 'replaced by ' + SUPERADMIN_NAME });
  });
  marks['retire-staff-2026-11'] = { at: Date.now(), retired };
  save();
  if (retired.length) console.log('  deactivated, replaced by ' + SUPERADMIN_NAME + ': ' + retired.join(', '));
}

/* One-time role correction: each ADVISOR_ONLY_EMAILS person keeps only their
   advising roles (superadmin and other admin roles are removed). Runs only
   when the dedicated superadmin account exists and is active, so the portal is
   never left without a superadmin, and only once, so later People-page
   changes are kept. */
function applyAdvisorOnlyOnce() {
  const marks = store._seeds || (store._seeds = {});
  if (marks['advisor-only-2026-11']) return;
  const keeper = SUPERADMIN_EMAIL && findPersonByEmail(SUPERADMIN_EMAIL);
  if (!keeper || keeper.active === false || !isSuperadmin(keeper.slug)) return;
  const changed = [];
  ADVISOR_ONLY_EMAILS.forEach(email => {
    const person = findPersonByEmail(email);
    if (!person || person.slug === keeper.slug) return;
    const before = JSON.parse(JSON.stringify(person));
    let roles = (person.roles || []).filter(r => r && r.role === 'advisor');
    if (!roles.length) {
      const tree = store['org/tree'] || OrgTree.DEFAULT_TREE;
      const scope = OrgTree.findNode(tree, 'cs') ? 'cs' : null;
      if (!scope) return;
      roles = [{ role: 'advisor', scopes: [scope] }];
    }
    if (JSON.stringify(roles) === JSON.stringify(person.roles)) return;
    person.roles = roles;
    changed.push(person.slug);
    audit('system', 'person-role-changed', { target: person.slug, before, after: person, reason: 'advisor only' });
  });
  marks['advisor-only-2026-11'] = { at: Date.now(), changed };
  save();
  if (changed.length) console.log('  advisor only from now on: ' + changed.join(', '));
}

/* Adds the faculties, departments and programmes of data/catalogue-2020.json
   that are not in the structure yet, and gives each programme without a study
   plan the plan read from the catalogue (marked "to check"). Runs once: a
   marker in the store stops it from bringing back anything removed later.
   Nothing that already exists is renamed, moved or replaced. */
function seedCatalogueOnce() {
  if (!SEED_CATALOGUE) return;
  const marks = store._seeds || (store._seeds = {});
  if (marks['catalogue-2020']) return;
  let seed;
  try { seed = require('./data/catalogue-2020.json'); } catch (e) { console.warn('catalogue seed missing; skipped'); return; }
  const tree = JSON.parse(JSON.stringify(store['org/tree'] || OrgTree.DEFAULT_TREE));
  const ids = new Set(OrgTree.allNodes(tree).map(n => n.id));
  let added = 0;
  const merge = (into, from, key, childKey) => (from[key] || []).forEach(child => {
    let have = (into[key] || []).find(x => x.id === child.id);
    if (!have) {
      if (ids.has(child.id)) return;            // that id is used elsewhere: leave it alone
      have = JSON.parse(JSON.stringify(childKey ? Object.assign({}, child, { [childKey]: [] }) : child));
      into[key].push(have); ids.add(child.id); added++;
    }
    if (childKey) merge(have, child, childKey, childKey === 'departments' ? 'programmes' : null);
  });
  merge(tree, seed.tree, 'faculties', 'departments');
  const check = OrgTree.validateTree(tree);
  if (!check.ok) { console.warn('catalogue seed not applied: ' + check.error); return; }
  const before = store['org/tree'] || null;
  store['org/tree'] = tree;
  const plans = [];
  Object.keys(seed.plans || {}).forEach(id => {
    if (id === 'cs' || !OrgTree.findNode(tree, id) || store['programmes/' + id + '/catalog']) return;
    store['programmes/' + id + '/catalog'] = Object.assign({}, seed.plans[id], { updatedAt: Date.now(), updatedBy: 'catalogue-2020' });
    plans.push(id);
  });
  marks['catalogue-2020'] = { at: Date.now(), added, plans };
  save();
  audit('system', 'catalogue-seeded', { before: before ? { faculties: (before.faculties || []).length } : null, added, plans });
  console.log('  catalogue 2020-2021: ' + added + ' faculties, departments and programmes added, ' + plans.length + ' study plans to check');
}

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
    const legacy = fs.existsSync(DATA_FILE) ? loadStore() : {};
    if (Object.keys(legacy).length) {
      if (!MIGRATE_FROM_VOLUME) {
        throw new Error('A legacy JSON store exists on the mounted volume; set MIGRATE_FROM_VOLUME=true to move it into PostgreSQL (see DEPLOY.md)');
      }
      const decryptLine = raw => {
        const parsed = JSON.parse(raw);
        if (sealed.isEnvelope(parsed)) {
          if (!STORE_KEY) throw new Error('the activity log is encrypted and STORE_KEY is not set');
          return sealed.decrypt(STORE_KEY, parsed);
        }
        return raw;
      };
      store = await VolumeMigration.migrateVolume({
        databaseStore, current: store, legacy,
        auditEntries: VolumeMigration.readLegacyAudit(AUDIT_FILE, decryptLine),
        files: { store: DATA_FILE, audit: AUDIT_FILE }
      });
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

  ensureSuperadminAccount();
  seedCatalogueOnce();
  applyAdvisorOnlyOnce();
  applyBauSuperadminOnce();
  sweepSessions();
  await flushStore();
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
// A crash still saves what is pending and exits non-zero so Railway restarts it.
process.on('uncaughtException', e => {
  console.error('uncaught exception:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
  shutdown('uncaught exception');
});
