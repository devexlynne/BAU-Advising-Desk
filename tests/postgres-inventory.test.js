'use strict';

const assert = require('assert');
const { inventory } = require('../src/postgres-inventory');

async function run() {
  let queryText = '';
  const report = await inventory({
    async query(sql) {
      queryText = sql;
      return {
        rows: [
          { schema_name: 'public', table_name: 'advising_app_data', estimated_rows: '5', total_bytes: '8192' },
          { schema_name: 'registrar', table_name: 'student_records', estimated_rows: '286', total_bytes: '32768' }
        ]
      };
    }
  });

  assert.strictEqual(report.tableCount, 2);
  assert.strictEqual(report.estimatedRows, 291);
  assert.strictEqual(report.totalBytes, 40960);
  assert.match(queryText, /pg_total_relation_size/);
  assert.doesNotMatch(queryText, /SELECT\s+\*/i);
  assert.doesNotMatch(JSON.stringify(report), /student name|student id|transcript contents/i);
  console.log('PostgreSQL inventory tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
