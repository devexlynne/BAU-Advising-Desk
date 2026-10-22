'use strict';

async function inventory(pool) {
  const result = await pool.query(
    `SELECT n.nspname AS schema_name,
            c.relname AS table_name,
            GREATEST(c.reltuples, 0)::bigint AS estimated_rows,
            pg_total_relation_size(c.oid)::bigint AS total_bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg_toast%'
     ORDER BY n.nspname, c.relname`
  );
  const tables = result.rows.map(row => ({
    schema: row.schema_name,
    table: row.table_name,
    estimatedRows: Number(row.estimated_rows),
    totalBytes: Number(row.total_bytes)
  }));
  return {
    note: 'Metadata only; row estimates may be stale. No row values were read or printed.',
    tables,
    tableCount: tables.length,
    estimatedRows: tables.reduce((sum, table) => sum + table.estimatedRows, 0),
    totalBytes: tables.reduce((sum, table) => sum + table.totalBytes, 0)
  };
}

module.exports = { inventory };
