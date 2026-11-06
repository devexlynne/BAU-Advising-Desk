'use strict';
/*
 * npm run db:setup  (run once, inside the Railway app service: railway ssh)
 *
 * Prepares a new, empty PostgreSQL service for the portal:
 *   1. reads the database's TLS certificate chain and keeps its root
 *      certificate, so every later connection is verified against it;
 *   2. installs the tables (the same SQL as npm run db:migrate);
 *   3. creates the limited account the app runs with (advising_app): it can
 *      read and write the records and add activity-log lines, nothing more;
 *   4. connects as that account and runs the same permission check the server
 *      runs at start-up;
 *   5. prints the variables to set on the app service.
 *
 * Needs DATABASE_MIGRATION_URL: the PostgreSQL service's own DATABASE_URL
 * (the administrator account). Give it only to this command; never set it on
 * the app service. Running it again gives the app account a new password.
 *
 *   DATABASE_MIGRATION_URL='postgresql://postgres:...@postgres.railway.internal:5432/railway' npm run db:setup
 *
 * Options: --role <name> (default advising_app), --ca-only (print the root
 * certificate and stop, e.g. after Railway renews the database certificate).
 */
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const path = require('path');
const crypto = require('crypto');
const { createPool, PostgresStore } = require('../src/postgres-store');

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const ROLE = arg('--role') || 'advising_app';
const MIGRATION = '001_advising_storage';

const pem = der => '-----BEGIN CERTIFICATE-----\n' + der.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';

/* PostgreSQL starts TLS inside its own protocol: send SSLRequest, wait for
   'S', then do the TLS handshake. The chain is only read here, not trusted
   for anything sensitive: no password is sent on this connection. */
function readChain(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      const req = Buffer.alloc(8); req.writeInt32BE(8, 0); req.writeInt32BE(80877103, 4); socket.write(req);
    });
    socket.setTimeout(8000, () => { socket.destroy(); reject(new Error('timed out reaching ' + host + ':' + port)); });
    socket.once('error', reject);
    socket.once('data', b => {
      if (b.toString('latin1', 0, 1) !== 'S') { socket.destroy(); return reject(new Error('the database does not offer TLS')); }
      const t = tls.connect({ socket, rejectUnauthorized: false, servername: net.isIP(host) ? undefined : host }, () => {
        const leaf = t.getPeerCertificate(true);
        let c = leaf, root = null;
        for (let i = 0; i < 10 && c; i++) {
          if (!c.issuerCertificate || c.issuerCertificate === c || c.issuerCertificate.fingerprint256 === c.fingerprint256) { root = c; break; }
          c = c.issuerCertificate;
        }
        t.end();
        if (!root || root === leaf) return reject(new Error('the database did not send a separate root certificate; set DATABASE_SSL_CA from the database service instead'));
        const names = String(leaf.subjectaltname || '').split(/,\s*/).map(s => s.replace(/^DNS:/, '')).filter(Boolean);
        if (leaf.subject && leaf.subject.CN) names.push(leaf.subject.CN);
        resolve({ rootPem: pem(root.raw), rootFingerprint: root.fingerprint256, leafNames: [...new Set(names)] });
      });
      t.once('error', reject);
    });
  });
}

async function main() {
  const adminUrl = process.env.DATABASE_MIGRATION_URL;
  if (!adminUrl) throw new Error('set DATABASE_MIGRATION_URL to the PostgreSQL service\'s DATABASE_URL for this command');
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(ROLE)) throw new Error('--role must be a plain lower-case name');
  const url = new URL(adminUrl);
  const host = url.hostname, port = Number(url.port || 5432);

  let ca = process.env.DATABASE_SSL_CA || '';
  let serverName = process.env.DATABASE_SSL_SERVER_NAME || '';
  if (!ca) {
    const chain = await readChain(host, port);
    ca = chain.rootPem;
    if (!serverName && !chain.leafNames.includes(host)) serverName = chain.leafNames[0] || '';
    console.log('Database root certificate: SHA-256 ' + chain.rootFingerprint);
    console.log('Database certificate names: ' + chain.leafNames.join(', '));
  }
  if (process.argv.includes('--ca-only')) {
    console.log('\nDATABASE_SSL_CA=\n' + ca);
    if (serverName) console.log('DATABASE_SSL_SERVER_NAME=' + serverName);
    return;
  }
  const tlsEnv = { DATABASE_SSL_CA: ca, ...(serverName ? { DATABASE_SSL_SERVER_NAME: serverName } : {}), NODE_ENV: 'production' };

  // 1-3: schema and the app account, as the administrator, in one transaction
  const admin = createPool({ DATABASE_URL: adminUrl, ...tlsEnv });
  const password = crypto.randomBytes(24).toString('base64url');
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(948483610218)');
    await client.query(`CREATE TABLE IF NOT EXISTS public.advising_schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const applied = await client.query('SELECT 1 FROM public.advising_schema_migrations WHERE version = $1', [MIGRATION]);
    if (!applied.rowCount) {
      await client.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', MIGRATION + '.sql'), 'utf8'));
      await client.query('INSERT INTO public.advising_schema_migrations (version) VALUES ($1)', [MIGRATION]);
      console.log('Tables installed.');
    } else console.log('Tables were already installed.');
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
    const verb = exists.rowCount ? 'ALTER' : 'CREATE';
    const sql = await client.query(
      `SELECT format('${verb} ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS q`,
      [ROLE, password]);
    await client.query(sql.rows[0].q);
    const db = (await client.query('SELECT current_database() AS d')).rows[0].d;
    const q = (await client.query('SELECT quote_ident($1) AS r, quote_ident($2) AS d', [ROLE, db])).rows[0];
    for (const stmt of [
      'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
      `REVOKE CREATE ON DATABASE ${q.d} FROM PUBLIC`,
      `REVOKE ALL ON DATABASE ${q.d} FROM ${q.r}`,
      `GRANT CONNECT ON DATABASE ${q.d} TO ${q.r}`,
      `REVOKE ALL ON SCHEMA public FROM ${q.r}`,
      `GRANT USAGE ON SCHEMA public TO ${q.r}`,
      `REVOKE ALL ON public.advising_app_data, public.advising_audit_log FROM ${q.r}`,
      `REVOKE ALL ON SEQUENCE public.advising_audit_log_id_seq FROM ${q.r}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON public.advising_app_data TO ${q.r}`,
      `GRANT INSERT ON public.advising_audit_log TO ${q.r}`,
      `GRANT USAGE ON SEQUENCE public.advising_audit_log_id_seq TO ${q.r}`
    ]) await client.query(stmt);
    await client.query('COMMIT');
    console.log('App account ' + ROLE + ' ' + (verb === 'CREATE' ? 'created' : 'given a new password') + '.');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (x) { /* already failed */ }
    throw e;
  } finally {
    client.release();
    await admin.end();
  }

  // 4: connect as the app account and run the server's own checks
  const appUrl = new URL(adminUrl);
  appUrl.username = ROLE; appUrl.password = password;
  ['sslmode', 'sslrootcert'].forEach(k => appUrl.searchParams.delete(k));
  const appPool = createPool({ DATABASE_URL: appUrl.toString(), ...tlsEnv });
  try {
    const store = new PostgresStore(appPool);
    await store.check();
    const rows = Object.keys(await store.readAll()).length;
    console.log('The app account passes the start-up permission check. Records in the database now: ' + rows + '.');
  } finally { await appPool.end(); }

  // 5: what to set on the app service
  console.log('\nSet these variables on the app service (Variables tab), then Deploy:\n');
  console.log('DATABASE_URL=' + appUrl.toString());
  if (serverName) console.log('DATABASE_SSL_SERVER_NAME=' + serverName);
  console.log('MIGRATE_FROM_VOLUME=true');
  console.log('DATABASE_SSL_CA=  (paste the whole block below, including the BEGIN and END lines)\n');
  console.log(ca);
  console.log('Keep STORE_KEY: the old store on the volume is still encrypted with it.');
}

main().catch(error => {
  console.error('Database setup failed:', error.code ? error.code + ' ' + error.message : error.message);
  process.exitCode = 1;
});
