'use strict';

const { createPool } = require('../src/postgres-store');
const { inventory } = require('../src/postgres-inventory');

async function main() {
  const pool = createPool();
  try {
    console.log(JSON.stringify(await inventory(pool), null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error('PostgreSQL inventory failed:', error.code || error.message);
  process.exitCode = 1;
});
