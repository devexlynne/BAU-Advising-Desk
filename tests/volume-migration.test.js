'use strict';
// The one-time move of the volume store into PostgreSQL (src/volume-migration.js)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sealed = require('../src/encrypted-file');
const M = require('../src/volume-migration');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAILED  ' + name + '\n     ' + e.message); }
}
// a stand-in for PostgresStore that keeps rows the way jsonb does (keys reordered)
function fakeDb(rows = {}, { corrupt = false } = {}) {
  const shuffle = v => Array.isArray(v) ? v.map(shuffle) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, shuffle(v[k])])) : v;
  return {
    rows, audit: [], saves: 0,
    async save(state, entries) {
      this.saves++;
      Object.keys(state).forEach(k => { this.rows[k] = shuffle(JSON.parse(JSON.stringify(state[k]))); });
      if (corrupt) this.rows[Object.keys(state)[0]] = { changed: true };
      this.audit.push(...entries);
    },
    async readAll() { return JSON.parse(JSON.stringify(this.rows)); }
  };
}
function volume(encrypted) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vol-'));
  const key = sealed.parseKey('11'.repeat(32));
  const store = {
    'org/tree': { id: 'bau', faculties: [{ id: 'science', departments: [] }] },
    'people/synthetic-advisor': { slug: 'synthetic-advisor', email: 'test.advisor@bau.edu.lb', roles: [{ role: 'advisor', scopes: ['cs'] }] },
    'advisors/synthetic-advisor/account': { slug: 'synthetic-advisor', hash: 'x', salt: 'y' },
    'advisors/synthetic-advisor/students/202599999': { id: '202599999', name: 'Synthetic Student', history: [{ code: 'CMPS241', grade: 'A' }] }
  };
  const lines = [
    { eventId: '0b8c5b1e-9a4f-4c1e-8f7a-2b1c3d4e5f60', at: '2026-10-01T08:00:00.000Z', actor: 'synthetic-advisor', action: 'signin', details: { ip: '127.0.0.1' } },
    { at: '2026-10-01T09:00:00.000Z', actor: 'system', action: 'org-migration', importedPeople: 1 }
  ];
  const storeFile = path.join(dir, 'store.json'), auditFile = path.join(dir, 'audit.log');
  fs.writeFileSync(storeFile, encrypted ? JSON.stringify(sealed.encrypt(key, JSON.stringify(store))) : JSON.stringify(store));
  fs.writeFileSync(auditFile, lines.map(l => encrypted ? JSON.stringify(sealed.encrypt(key, JSON.stringify(l))) : JSON.stringify(l)).join('\n') + '\n');
  const decryptLine = raw => { const p = JSON.parse(raw); return sealed.isEnvelope(p) ? sealed.decrypt(key, p) : raw; };
  return { dir, store, storeFile, auditFile, decryptLine };
}

(async () => {
  console.log('\n--- moving the volume store into PostgreSQL ---');
  await test('an encrypted volume is copied whole, checked, and only then set aside', async () => {
    const v = volume(true); const db = fakeDb();
    const audit = M.readLegacyAudit(v.auditFile, v.decryptLine);
    assert.strictEqual(audit.length, 2);
    const state = await M.migrateVolume({ databaseStore: db, current: {}, legacy: v.store, auditEntries: audit,
      files: { store: v.storeFile, audit: v.auditFile }, log: () => {} });
    assert.deepStrictEqual(M.differences(v.store, state), []);
    assert.strictEqual(db.saves, 1, 'one transaction');
    assert.strictEqual(db.audit.length, 3, 'the old activity plus one "volume-migrated" entry');
    assert.ok(db.audit.some(e => e.action === 'volume-migrated' && e.details.students === 1));
    assert.ok(!fs.existsSync(v.storeFile) && !fs.existsSync(v.auditFile), 'old files renamed');
    const kept = fs.readdirSync(v.dir);
    assert.ok(kept.some(f => /^store\.json\.migrated-/.test(f)) && kept.some(f => /^audit\.log\.migrated-/.test(f)), 'old files kept');
  });
  await test('old activity lines keep their ids and times; missing ones are filled in', async () => {
    const v = volume(false); const audit = M.readLegacyAudit(v.auditFile, v.decryptLine);
    assert.strictEqual(audit[0].eventId, '0b8c5b1e-9a4f-4c1e-8f7a-2b1c3d4e5f60');
    assert.strictEqual(audit[1].action, 'org-migration');
    assert.strictEqual(audit[1].details.importedPeople, 1);
    assert.ok(/^[0-9a-f-]{36}$/.test(audit[1].eventId));
  });
  await test('a copy that does not read back the same stops, and the volume is untouched', async () => {
    const v = volume(true); const db = fakeDb({}, { corrupt: true });
    await assert.rejects(M.migrateVolume({ databaseStore: db, current: {}, legacy: v.store, auditEntries: [],
      files: { store: v.storeFile, audit: v.auditFile }, log: () => {} }), /does not match/);
    assert.ok(fs.existsSync(v.storeFile) && fs.existsSync(v.auditFile));
  });
  await test('a database that already holds other data is never overwritten', async () => {
    const v = volume(true); const db = fakeDb({ 'org/tree': { id: 'other' } });
    await assert.rejects(M.migrateVolume({ databaseStore: db, current: { 'org/tree': { id: 'other' } }, legacy: v.store,
      auditEntries: [], files: { store: v.storeFile, audit: v.auditFile }, log: () => {} }), /already holds data/);
    assert.strictEqual(db.saves, 0); assert.ok(fs.existsSync(v.storeFile));
  });
  await test('a run that committed but could not rename the files finishes on the next start', async () => {
    const v = volume(true); const current = JSON.parse(JSON.stringify(v.store)); const db = fakeDb(current);
    const state = await M.migrateVolume({ databaseStore: db, current, legacy: v.store, auditEntries: [],
      files: { store: v.storeFile, audit: v.auditFile }, log: () => {} });
    assert.strictEqual(db.saves, 0, 'nothing copied twice');
    assert.ok(!fs.existsSync(v.storeFile)); assert.deepStrictEqual(M.differences(v.store, state), []);
  });
  await test('the server refuses a volume store unless MIGRATE_FROM_VOLUME is set', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(/if \(!MIGRATE_FROM_VOLUME\)\s*{\s*throw new Error\('A legacy JSON store exists/.test(src));
  });
  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
