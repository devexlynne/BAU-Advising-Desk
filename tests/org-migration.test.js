'use strict';

const assert = require('assert');
const { DEFAULT_TREE, migrateStore, validateTree } = require('../src/org-tree');

const staff = [
  { slug: 'synthetic-admin', name: 'Synthetic Admin', email: 'admin@example.invalid', faculty: 'Science', department: 'Computer Science', admin: true },
  { slug: 'synthetic-advisor', name: 'Synthetic Advisor', email: 'advisor@example.invalid', faculty: 'Science', department: 'Computer Science', photo: 'data:image/png;base64,AA==' }
];
const store = {
  'advisors/synthetic-admin/account': { email: 'admin@example.invalid', verified: true, salt: 'preserved-salt', hash: 'preserved-hash' },
  'advisors/synthetic-advisor/account': { email: 'advisor@example.invalid', verified: true, salt: 'advisor-salt', hash: 'advisor-hash' }
};

const first = migrateStore(store, staff, ['synthetic-admin']);
assert.strictEqual(first.changed, true);
assert.strictEqual(first.seededTree, true);
assert.deepStrictEqual(store['org/tree'], DEFAULT_TREE);
assert.deepStrictEqual(store['people/synthetic-admin'].roles, [{ role: 'superadmin', scopes: ['bau'] }]);
assert.deepStrictEqual(store['people/synthetic-advisor'].roles, [{ role: 'advisor', scopes: ['cs'] }]);
assert.strictEqual(store['people/synthetic-advisor'].photo, staff[1].photo);
assert.strictEqual(store['people/synthetic-advisor'].verified, true);
assert.strictEqual(store['advisors/synthetic-admin/account'].hash, 'preserved-hash');

const snapshot = JSON.stringify(store);
const second = migrateStore(store, staff, ['synthetic-admin']);
assert.strictEqual(second.changed, false);
assert.strictEqual(second.seededTree, false);
assert.deepStrictEqual(second.importedPeople, []);
assert.strictEqual(JSON.stringify(store), snapshot, 'a repeated migration must leave every key unchanged');

assert.strictEqual(validateTree({
  id: 'bau',
  name: 'Synthetic University',
  faculties: [{ id: 'bad/id', name: 'Invalid Faculty', departments: [] }]
}).ok, false);
console.log('  organisation seed and idempotent migration checks passed');
