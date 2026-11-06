'use strict';

const { Pool } = require('pg');
const tls = require('tls');

function createPool(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL storage');

  const connectionUrl = new URL(env.DATABASE_URL);
  ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach(name => connectionUrl.searchParams.delete(name));

  const production = env.NODE_ENV === 'production'
    || !!env.RAILWAY_ENVIRONMENT_NAME
    || !!env.RAILWAY_SERVICE_ID;
  if (String(env.DATABASE_SSL || '').toLowerCase() === 'disable' && production) {
    throw new Error('DATABASE_SSL=disable is not allowed in production');
  }

  const ssl = String(env.DATABASE_SSL || '').toLowerCase() === 'disable'
    ? false
    : {
      rejectUnauthorized: true,
      ...(env.DATABASE_SSL_SERVER_NAME ? {
        checkServerIdentity: (_connectionHost, certificate) =>
          tls.checkServerIdentity(env.DATABASE_SSL_SERVER_NAME, certificate)
      } : {}),
      ...(env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA } : {})
    };

  return new Pool({
    connectionString: connectionUrl.toString(),
    ssl,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000
  });
}

const cloneJson = value => JSON.parse(JSON.stringify(value));

class PostgresStore {
  constructor(pool, onConnectionError = () => {}) {
    this.pool = pool;
    this.persisted = {};
    this.lockClient = null;
    this.connectionError = null;
    this.onConnectionError = onConnectionError;
    this.pool.on('error', error => this.reportConnectionError(error));
  }

  reportConnectionError(error) {
    if (this.connectionError) return;
    this.connectionError = error;
    this.onConnectionError(error);
  }

  assertAvailable() {
    if (this.connectionError) {
      throw new Error('PostgreSQL reported an unexpected connection error');
    }
  }

  async load() {
    this.assertAvailable();
    try {
      this.lockClient = await this.pool.connect();
      this.lockClient.on('error', error => this.reportConnectionError(error));
      const lock = await this.lockClient.query('SELECT pg_try_advisory_lock(948483610217) AS acquired');
      if (!lock.rows[0].acquired) {
        throw new Error('another advising server instance already holds the database lock; run one instance only');
      }
      this.assertAvailable();
      const result = await this.pool.query(
        'SELECT key, value FROM public.advising_app_data ORDER BY key'
      );
      const state = {};
      result.rows.forEach(row => { state[row.key] = row.value; });
      this.persisted = cloneJson(state);
      return state;
    } catch (error) {
      if (this.lockClient) {
        this.lockClient.release();
        this.lockClient = null;
      }
      if (error.code === '42P01') {
        throw new Error('PostgreSQL schema is not installed; run npm run db:migrate before starting the app');
      }
      throw error;
    }
  }

  // every key as stored now, used to verify a copy
  async readAll() {
    this.assertAvailable();
    const result = await this.pool.query('SELECT key, value FROM public.advising_app_data ORDER BY key');
    const state = {};
    result.rows.forEach(row => { state[row.key] = row.value; });
    return state;
  }

  async check() {
    this.assertAvailable();
    const tables = await this.pool.query(
      `SELECT to_regclass('public.advising_app_data') AS app_data,
              to_regclass('public.advising_audit_log') AS audit_log,
              to_regclass('public.advising_audit_log_id_seq') AS audit_id_seq`
    );
    const row = tables.rows[0];
    if (!row.app_data || !row.audit_log || !row.audit_id_seq) {
      throw new Error('PostgreSQL schema is incomplete; run npm run db:migrate before starting the app');
    }
    const privileges = await this.pool.query(
      `SELECT
              (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
               FROM pg_roles WHERE rolname = current_user) AS has_role_admin_privileges,
              has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_in_database,
              has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
              has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_schema,
              pg_has_role(current_user,
                (SELECT datdba FROM pg_database WHERE datname = current_database()), 'MEMBER')
                AS owns_database,
              pg_has_role(current_user,
                (SELECT nspowner FROM pg_namespace WHERE nspname = 'public'), 'MEMBER')
                AS owns_schema,
              pg_has_role(current_user,
                (SELECT relowner FROM pg_class WHERE oid = 'public.advising_app_data'::regclass), 'MEMBER')
                AS owns_app_data,
              pg_has_role(current_user,
                (SELECT relowner FROM pg_class WHERE oid = 'public.advising_audit_log'::regclass), 'MEMBER')
                AS owns_audit_log,
              pg_has_role(current_user,
                (SELECT relowner FROM pg_class WHERE oid = 'public.advising_audit_log_id_seq'::regclass), 'MEMBER')
                AS owns_audit_sequence,
              has_table_privilege(current_user, 'public.advising_app_data', 'SELECT') AS can_read,
              has_table_privilege(current_user, 'public.advising_app_data', 'INSERT') AS can_insert,
              has_table_privilege(current_user, 'public.advising_app_data', 'UPDATE') AS can_update,
              has_table_privilege(current_user, 'public.advising_app_data', 'DELETE') AS can_delete,
              has_table_privilege(current_user, 'public.advising_app_data', 'TRUNCATE') AS can_truncate_app_data,
              has_table_privilege(current_user, 'public.advising_app_data', 'REFERENCES') AS can_reference_app_data,
              has_table_privilege(current_user, 'public.advising_app_data', 'TRIGGER') AS can_trigger_app_data,
              has_table_privilege(current_user, 'public.advising_audit_log', 'INSERT') AS can_audit,
              has_table_privilege(current_user, 'public.advising_audit_log', 'SELECT') AS can_read_audit,
              has_table_privilege(current_user, 'public.advising_audit_log', 'UPDATE') AS can_update_audit,
              has_table_privilege(current_user, 'public.advising_audit_log', 'DELETE') AS can_delete_audit,
              has_table_privilege(current_user, 'public.advising_audit_log', 'TRUNCATE') AS can_truncate_audit,
              has_table_privilege(current_user, 'public.advising_audit_log', 'REFERENCES') AS can_reference_audit,
              has_table_privilege(current_user, 'public.advising_audit_log', 'TRIGGER') AS can_trigger_audit,
              has_sequence_privilege(current_user, 'public.advising_audit_log_id_seq', 'USAGE') AS can_use_audit_sequence,
              has_sequence_privilege(current_user, 'public.advising_audit_log_id_seq', 'SELECT') AS can_read_audit_sequence,
              has_sequence_privilege(current_user, 'public.advising_audit_log_id_seq', 'UPDATE') AS can_update_audit_sequence`
    );
    const grants = privileges.rows[0];
    const required = [
      'can_use_schema', 'can_read', 'can_insert', 'can_update', 'can_delete',
      'can_audit', 'can_use_audit_sequence'
    ];
    const forbidden = [
      'has_role_admin_privileges', 'can_create_in_database', 'can_create_in_schema',
      'owns_database', 'owns_schema', 'owns_app_data', 'owns_audit_log',
      'owns_audit_sequence', 'can_truncate_app_data', 'can_reference_app_data',
      'can_trigger_app_data', 'can_read_audit', 'can_update_audit', 'can_delete_audit',
      'can_truncate_audit', 'can_reference_audit', 'can_trigger_audit',
      'can_read_audit_sequence', 'can_update_audit_sequence'
    ];
    if (required.some(name => grants[name] !== true)
      || forbidden.some(name => grants[name] !== false)) {
      throw new Error('PostgreSQL application role must have only the required storage permissions');
    }
  }

  async save(state, auditEntries = []) {
    this.assertAvailable();
    const next = cloneJson(state);
    const previous = this.persisted;
    const changed = Object.keys(next).filter(key =>
      !Object.prototype.hasOwnProperty.call(previous, key)
      || JSON.stringify(next[key]) !== JSON.stringify(previous[key]));
    const removed = Object.keys(previous).filter(key =>
      !Object.prototype.hasOwnProperty.call(next, key));

    if (!changed.length && !removed.length && !auditEntries.length) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (removed.length) {
        await client.query(
          'DELETE FROM public.advising_app_data WHERE key = ANY($1::text[])',
          [removed]
        );
      }
      if (changed.length) {
        const values = changed.map(key => JSON.stringify(next[key]));
        await client.query(
          `INSERT INTO public.advising_app_data (key, value)
           SELECT entries.key, entries.value::jsonb
           FROM unnest($1::text[], $2::text[]) AS entries(key, value)
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
          [changed, values]
        );
      }
      for (const entry of auditEntries) {
        await client.query(
          `INSERT INTO public.advising_audit_log (event_id, occurred_at, actor, action, details)
           VALUES ($1::uuid, $2::timestamptz, $3, $4, $5::jsonb)`,
          [entry.eventId, entry.at, entry.actor, entry.action, JSON.stringify(entry.details)]
        );
      }
      await client.query('COMMIT');
      this.persisted = next;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        console.error('PostgreSQL rollback failed:', rollbackError.code || rollbackError.message);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.lockClient) {
      let unlockError = null;
      try { await this.lockClient.query('SELECT pg_advisory_unlock(948483610217)'); }
      catch (error) { unlockError = error; }
      finally {
        this.lockClient.release();
        this.lockClient = null;
      }
      await this.pool.end();
      if (unlockError) throw unlockError;
      return;
    }
    await this.pool.end();
  }
}

module.exports = { PostgresStore, createPool };
