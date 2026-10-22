'use strict';

const fs = require('fs');
const path = require('path');
const { createPool } = require('../src/postgres-store');

async function main() {
  const env = Object.assign({}, process.env, {
    DATABASE_URL: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL
  });
  const pool = createPool(env);
  const name = '001_advising_storage';
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', name + '.sql'), 'utf8');
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(948483610218)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS public.advising_schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    const applied = await client.query(
      'SELECT 1 FROM public.advising_schema_migrations WHERE version = $1',
      [name]
    );
    if (applied.rowCount) {
      await client.query('ROLLBACK');
      console.log('PostgreSQL storage schema is already installed.');
      return;
    }
    await client.query(migration);
    await client.query(
      'INSERT INTO public.advising_schema_migrations (version) VALUES ($1)',
      [name]
    );
    await client.query('COMMIT');
    console.log('PostgreSQL storage schema is installed.');
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        console.error('PostgreSQL migration rollback failed:', rollbackError.code || rollbackError.message);
      }
    }
    throw error;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('PostgreSQL migration failed:', error.code || error.message);
  process.exitCode = 1;
});
