'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { PostgresStore, createPool } = require('../src/postgres-store');

async function run() {
  const securePool = createPool({
    DATABASE_URL: 'postgres://advising:secret@localhost/advising?sslmode=disable',
    NODE_ENV: 'production'
  });
  assert.strictEqual(securePool.options.ssl.rejectUnauthorized, true);
  assert.strictEqual(new URL(securePool.options.connectionString).searchParams.has('sslmode'), false);
  await securePool.end();

  const caPool = createPool({
    DATABASE_URL: 'postgres://localhost/advising',
    DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----',
    DATABASE_SSL_SERVER_NAME: 'localhost',
    NODE_ENV: 'production'
  });
  assert.strictEqual(caPool.options.ssl.ca, '-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----');
  assert.strictEqual(caPool.options.ssl.servername, 'localhost');
  assert.strictEqual(caPool.options.ssl.rejectUnauthorized, true);
  await caPool.end();

  const statements = [];
  const client = Object.assign(new EventEmitter(), {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      return { rows: [] };
    },
    release() {}
  });
  const pool = Object.assign(new EventEmitter(), {
    async connect() { return client; },
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('SELECT key, value')) {
        return { rows: [{ key: 'config/catalog', value: { year: 2026 } }] };
      }
      if (sql.includes('to_regclass')) {
        return { rows: [{
          app_data: 'advising_app_data',
          audit_log: 'advising_audit_log',
          audit_id_seq: 'advising_audit_log_id_seq'
        }] };
      }
      if (sql.includes('has_table_privilege')) {
        return { rows: [{
          has_role_admin_privileges: false,
          can_create_in_database: false,
          can_use_schema: true,
          can_create_in_schema: false,
          owns_database: false,
          owns_schema: false,
          owns_app_data: false,
          owns_audit_log: false,
          owns_audit_sequence: false,
          can_read: true, can_insert: true, can_update: true,
          can_delete: true, can_truncate_app_data: false,
          can_reference_app_data: false, can_trigger_app_data: false,
          can_audit: true, can_read_audit: false, can_update_audit: false,
          can_delete_audit: false, can_truncate_audit: false,
          can_reference_audit: false, can_trigger_audit: false,
          can_use_audit_sequence: true, can_read_audit_sequence: false,
          can_update_audit_sequence: false
        }] };
      }
      return { rows: [] };
    },
    async end() {}
  });

  const store = new PostgresStore(pool);
  assert.deepStrictEqual(await store.load(), { 'config/catalog': { year: 2026 } });
  await store.check();
  await store.save({
    'config/catalog': { year: 2026 },
    'config/rules': { version: 1 }
  });
  await store.save({ 'config/rules': { version: 2 } }, [{
    eventId: 'd9428888-4320-4f6e-96d9-6d598a95d8fc',
    at: '2026-01-01T00:00:00.000Z',
    actor: 'advisor-a',
    action: 'test',
    details: { count: 1 }
  }]);

  assert.ok(statements.some(s => s.sql.includes('INSERT INTO public.advising_app_data')));
  assert.ok(statements.some(s => s.sql.includes('DELETE FROM public.advising_app_data')));
  assert.ok(statements.some(s => s.sql.includes('INSERT INTO public.advising_audit_log')));
  assert.ok(statements.some(s => s.sql.includes('INSERT INTO public.advising_audit_log')
    && !s.sql.includes('ON CONFLICT')));
  assert.deepStrictEqual(
    statements.filter(s => s.sql === 'BEGIN' || s.sql === 'COMMIT').map(s => s.sql),
    ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']
  );

  const overprivilegedPool = Object.assign(new EventEmitter(), {
    async query(sql) {
      if (sql.includes('to_regclass')) {
        return { rows: [{
          app_data: 'advising_app_data',
          audit_log: 'advising_audit_log',
          audit_id_seq: 'advising_audit_log_id_seq'
        }] };
      }
      return { rows: [{
        has_role_admin_privileges: false,
        can_create_in_database: false,
        can_use_schema: true,
        can_create_in_schema: false,
        owns_database: false,
        owns_schema: false,
        owns_app_data: false,
        owns_audit_log: false,
        owns_audit_sequence: false,
        can_read: true, can_insert: true, can_update: true, can_delete: true,
        can_truncate_app_data: true,
        can_reference_app_data: false,
        can_trigger_app_data: false,
        can_audit: true,
        can_read_audit: false,
        can_update_audit: false,
        can_delete_audit: false,
        can_truncate_audit: false,
        can_reference_audit: false,
        can_trigger_audit: false,
        can_use_audit_sequence: true,
        can_read_audit_sequence: false,
        can_update_audit_sequence: false
      }] };
    },
    async end() {}
  });
  const overprivilegedStore = new PostgresStore(overprivilegedPool);
  await assert.rejects(overprivilegedStore.check(), /only the required storage permissions/);
  await overprivilegedStore.close();

  await store.close();

  let reportedError = null;
  const failingClient = Object.assign(new EventEmitter(), {
    async query(sql) {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      return { rows: [] };
    },
    release() {}
  });
  const failingPool = Object.assign(new EventEmitter(), {
    async connect() { return failingClient; },
    async query() { return { rows: [] }; },
    async end() {}
  });
  const failingStore = new PostgresStore(failingPool, error => { reportedError = error; });
  await failingStore.load();
  const connectionError = Object.assign(new Error('connection lost'), { code: 'ECONNRESET' });
  failingClient.emit('error', connectionError);
  assert.strictEqual(reportedError, connectionError, 'lock connection errors are reported');
  await assert.rejects(failingStore.check(), /unexpected connection error/);
  await failingStore.close();

  reportedError = null;
  const idlePool = Object.assign(new EventEmitter(), {
    async end() {}
  });
  const idleStore = new PostgresStore(idlePool, error => { reportedError = error; });
  idlePool.emit('error', connectionError);
  assert.strictEqual(reportedError, connectionError, 'idle pool errors are reported');
  await assert.rejects(idleStore.save({}), /unexpected connection error/);
  await idleStore.close();

  console.log('PostgreSQL store tests passed.');
}

assert.throws(() => createPool({
  DATABASE_URL: 'postgres://localhost/advising',
  NODE_ENV: 'production',
  DATABASE_SSL: 'disable'
}), /not allowed in production/);

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
