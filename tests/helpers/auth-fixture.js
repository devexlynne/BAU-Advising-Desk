'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DEFAULT_TREE, mergeTree } = require('../../src/org-tree');
const { DEMO_ORG } = require('../../scripts/seed-demo-org');

const PASSWORDS = {
  admin: 'Synthetic-admin-pass-2026',
  advisor: 'Synthetic-advisor-pass-2026',
  business: 'Synthetic-business-pass-2026',
  editor: 'Synthetic-editor-pass-2026'
};

function account(slug, email, password, verified = true) {
  const salt = crypto.createHash('sha256').update('synthetic:' + slug).digest('hex').slice(0, 32);
  return {
    slug, email, salt,
    hash: crypto.pbkdf2Sync(password, 'bau:' + salt, 310000, 32, 'sha256').toString('hex'),
    verified, createdAt: 1, lastSignIn: 1
  };
}

function person(slug, email, roles, extra = {}) {
  return Object.assign({
    slug, name: 'Synthetic ' + slug, title: 'Synthetic staff member', email,
    photo: '', faculty: 'Faculty of Science', department: 'Mathematics and Computer Science',
    active: true, roles
  }, extra);
}

function defaultStore() {
  const store = { 'org/tree': mergeTree(DEFAULT_TREE, DEMO_ORG) };
  const people = [
    person('synthetic-superadmin', 'test.superadmin@bau.edu.lb', [{ role: 'superadmin', scopes: ['bau'] }]),
    person('synthetic-cs-advisor', 'test.advisor@bau.edu.lb', [{ role: 'advisor', scopes: ['cs'] }]),
    person('synthetic-business-admin', 'test.business.admin@bau.edu.lb', [{ role: 'faculty-admin', scopes: ['business-administration'] }], {
      faculty: 'Faculty of Business Administration', department: 'Accounting'
    }),
    person('synthetic-business-editor', 'test.business.editor@bau.edu.lb', [{ role: 'programme-editor', scopes: ['bba-accounting'] }], {
      faculty: 'Faculty of Business Administration', department: 'Accounting'
    })
  ];
  people.forEach(value => { store['people/' + value.slug] = value; });
  store['advisors/synthetic-superadmin/account'] = account('synthetic-superadmin', 'test.superadmin@bau.edu.lb', PASSWORDS.admin);
  store['advisors/synthetic-cs-advisor/account'] = account('synthetic-cs-advisor', 'test.advisor@bau.edu.lb', PASSWORDS.advisor);
  store['advisors/synthetic-business-admin/account'] = account('synthetic-business-admin', 'test.business.admin@bau.edu.lb', PASSWORDS.business);
  store['advisors/synthetic-business-editor/account'] = account('synthetic-business-editor', 'test.business.editor@bau.edu.lb', PASSWORDS.editor);
  return store;
}

function writeStore(dataDir, store = defaultStore()) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'store.json'), JSON.stringify(store));
  return store;
}

module.exports = { PASSWORDS, account, person, defaultStore, writeStore };
