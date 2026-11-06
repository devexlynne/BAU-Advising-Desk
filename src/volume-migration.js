'use strict';
/*
 * One-time move of the Railway volume store into PostgreSQL.
 *
 * The server calls migrateVolume() at start-up only when DATABASE_URL is set,
 * the old store.json on the volume is not empty, and MIGRATE_FROM_VOLUME=true.
 *
 * 1. Every key of the old store and every line of the old activity log is
 *    written to PostgreSQL in ONE transaction (PostgresStore.save).
 * 2. Every key is read back and compared value by value. Any difference stops
 *    the server; the volume files are not touched.
 * 3. Only then are store.json and audit.log renamed to *.migrated-<time>, so
 *    they are kept (still encrypted) but never read again.
 *
 * If PostgreSQL already holds data, nothing is copied: the server stops,
 * unless the database already holds exactly the volume's data (a previous run
 * committed but could not rename the files), in which case the files are
 * renamed and the server starts.
 */
const fs = require('fs');
const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// JSON with object keys sorted, so jsonb's key order does not matter
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

// keys of `expected` that are missing or different in `actual`
function differences(expected, actual) {
  return Object.keys(expected).filter(key =>
    !Object.prototype.hasOwnProperty.call(actual, key) || canonical(expected[key]) !== canonical(actual[key]));
}

/* The old activity log: one JSON line per event, each line encrypted on its
   own when STORE_KEY is set. Lines are turned into the database's audit rows. */
function readLegacyAudit(file, decryptLine) {
  if (!fs.existsSync(file)) return [];
  const seen = new Set();
  const out = [];
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, n) => {
    if (!raw.trim()) return;
    let line;
    try { line = JSON.parse(decryptLine(raw)); } catch (e) {
      throw new Error('activity log line ' + (n + 1) + ' cannot be read: ' + e.message);
    }
    if (!line || typeof line !== 'object') return;
    let eventId = UUID.test(String(line.eventId || '')) ? String(line.eventId).toLowerCase() : crypto.randomUUID();
    if (seen.has(eventId)) return;
    seen.add(eventId);
    const at = !isNaN(Date.parse(line.at)) ? new Date(line.at).toISOString()
      : !isNaN(Date.parse(line.time)) ? new Date(line.time).toISOString() : null;
    let details = line.details && typeof line.details === 'object' ? line.details : null;
    if (!details) {
      details = Object.assign({}, line);
      ['eventId', 'at', 'time', 'actor', 'action'].forEach(k => delete details[k]);
    }
    out.push({
      eventId,
      at: at || new Date(0).toISOString(),
      actor: line.actor == null ? null : String(line.actor).slice(0, 200),
      action: String(line.action || 'legacy-event').slice(0, 100) || 'legacy-event',
      details: Object.assign({}, details, at ? {} : { legacyTimeMissing: true })
    });
  });
  return out;
}

// counts only, never values: what kind of keys were moved
function summarize(state) {
  const keys = Object.keys(state);
  return {
    keys: keys.length,
    people: keys.filter(k => /^people\//.test(k)).length,
    accounts: keys.filter(k => /^advisors\/[^/]+\/account$/.test(k)).length,
    students: keys.filter(k => /^advisors\/[^/]+\/students\/[^/]+$/.test(k)).length
  };
}

/*
 * databaseStore: a loaded PostgresStore (or anything with save() and readAll())
 * current:       what PostgreSQL held at start-up
 * legacy:        the decrypted old store
 * auditEntries:  readLegacyAudit() output
 * files:         { store, audit } paths to rename once verified
 * Returns the state the server should run with.
 */
async function migrateVolume({ databaseStore, current, legacy, auditEntries, files, now = new Date(), log = console.log }) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const archive = () => {
    const moved = [];
    [files.store, files.audit].forEach(file => {
      if (file && fs.existsSync(file)) {
        const to = file + '.migrated-' + stamp;
        fs.renameSync(file, to); moved.push(to);
      }
    });
    return moved;
  };

  if (Object.keys(current).length) {
    // a previous run may have committed and then failed to rename the files
    if (!differences(legacy, current).length) {
      const moved = archive();
      log('  volume store already in PostgreSQL; old files set aside: ' + moved.join(', '));
      return current;
    }
    throw new Error('PostgreSQL already holds data that differs from the volume store; nothing was copied. '
      + 'Check which copy is current before migrating.');
  }

  const counts = summarize(legacy);
  const entries = auditEntries.concat([{
    eventId: crypto.randomUUID(), at: now.toISOString(), actor: 'system', action: 'volume-migrated',
    details: Object.assign({ auditLines: auditEntries.length }, counts)
  }]);
  await databaseStore.save(legacy, entries);

  const back = await databaseStore.readAll();
  const wrong = differences(legacy, back);
  const extra = Object.keys(back).filter(k => !Object.prototype.hasOwnProperty.call(legacy, k));
  if (wrong.length || extra.length) {
    throw new Error('PostgreSQL does not match the volume store after copying (' + wrong.length + ' different, '
      + extra.length + ' unexpected keys). The volume files were not touched.');
  }
  const moved = archive();
  log('  moved the volume store into PostgreSQL: ' + counts.keys + ' keys (' + counts.people + ' people, '
    + counts.accounts + ' accounts, ' + counts.students + ' student records) and ' + auditEntries.length + ' activity entries');
  log('  old files kept on the volume as: ' + moved.join(', '));
  return back;
}

module.exports = { canonical, differences, readLegacyAudit, summarize, migrateVolume };
