const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bau-volume-inventory-'));

try {
  const backupDir = path.join(temp, 'backups');
  fs.mkdirSync(backupDir);
  fs.writeFileSync(path.join(temp, 'store.json'), JSON.stringify({
    'advisors/example/account': { email: 'PRIVATE_SENTINEL@example.edu' },
    'advisors/example/students/123456789': { name: 'PRIVATE_STUDENT_SENTINEL' },
    'advisors/example/settings': { term: 'FALL' },
    _sessions: { tokenHash: { slug: 'example' } },
    _resets: {},
    _verifies: {}
  }));
  fs.writeFileSync(path.join(temp, 'audit.log'), JSON.stringify({
    actor: 'PRIVATE_ACTOR_SENTINEL',
    action: 'signin',
    ip: 'PRIVATE_IP_SENTINEL'
  }) + '\n');
  fs.writeFileSync(path.join(backupDir, 'store-test.json'), '{}');

  const output = execFileSync(process.execPath, ['scripts/inventory-volume.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { DATA_DIR: temp }),
    encoding: 'utf8'
  });
  const inventory = JSON.parse(output);
  assert.strictEqual(inventory.studentRecords, 1);
  assert.strictEqual(inventory.advisorAccounts, 1);
  assert.strictEqual(inventory.advisors, 1);
  assert.strictEqual(inventory.sessions, 1);
  assert.strictEqual(inventory.backups, 1);
  assert.strictEqual(inventory.auditLines, 1);
  assert.ok(!/PRIVATE_/.test(output));
  console.log('  ok  volume inventory reports counts without exposing stored values');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
