'use strict';

const assert = require('assert');
const { DEFAULT_TREE } = require('../src/org-tree');
const { can, isSuperadmin } = require('../src/permissions');

const tree = {
  ...DEFAULT_TREE,
  faculties: [
    ...DEFAULT_TREE.faculties,
    { id: 'business', name: 'Faculty of Business Administration', departments: [{
      id: 'accounting', name: 'Accounting', programmes: [
        { id: 'bba-accounting', name: 'BBA Accounting', campuses: ['Beirut'] }
      ]
    }] }
  ]
};
const businessAdmin = {
  slug: 'synthetic-business-admin',
  active: true,
  roles: [{ role: 'faculty-admin', scopes: ['business'] }]
};
const superadmin = {
  slug: 'synthetic-superadmin',
  active: true,
  roles: [{ role: 'superadmin', scopes: ['bau'] }]
};
const editor = {
  slug: 'synthetic-editor',
  active: true,
  roles: [{ role: 'programme-editor', scopes: ['bba-accounting'] }]
};

assert.strictEqual(can(businessAdmin, 'people:read', 'business', tree), true);
assert.strictEqual(can(businessAdmin, 'people:read', 'science', tree), false,
  'a Business faculty-admin cannot list people in Science');
assert.strictEqual(can(businessAdmin, 'students:read', 'cs', tree), false,
  'a Business faculty-admin cannot read Science student records');
assert.strictEqual(can(businessAdmin, 'students:write', 'cs', tree), false,
  'a Business faculty-admin cannot change Science student records');
assert.strictEqual(can(businessAdmin, 'offering:write', 'cs', tree), true,
  'faculty-admins may manage the university-wide offering');
assert.strictEqual(can(businessAdmin, 'brand:write', 'bau', tree), false,
  'brand writes are superadmin-only');
assert.strictEqual(can(editor, 'rules:write', 'bba-accounting', tree), true);
assert.strictEqual(can(editor, 'rules:write', 'cs', tree), false);
assert.strictEqual(can(editor, 'offering:write', 'bba-accounting', tree), false);
assert.strictEqual(isSuperadmin(superadmin), true);
assert.strictEqual(isSuperadmin({ ...superadmin, active: false }), false);
assert.strictEqual(can({ slug: 'bootstrap-admin', active: true }, 'org:write', null, tree, ['bootstrap-admin']), true);
console.log('  10 permission checks passed');
