'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, ['build.js'], { cwd: root, stdio: 'ignore' });
const html = fs.readFileSync(path.join(root, 'build', 'index.html'), 'utf8');

assert.ok(!html.includes('window.FACULTY='), 'public HTML must not include the portal\'s staff records');
assert.ok(!html.includes('data-pick='), 'public sign-in must not render the old account picker');
assert.ok(html.includes('BAU email'), 'the sign-in screen must ask for a BAU email');

/* The sign-in directory is public on purpose: it repeats the academic staff
   pages of www.bau.edu.lb so staff can find their faculty, department and own
   card. It must carry only what BAU already publishes, never accounts, roles,
   password data or anything about students. */
const dir = require('../data/directory.json');
const allowedPerson = new Set(['name', 'title', 'faculty', 'department', 'email', 'photo', 'photoData']);
assert.ok(html.includes('window.BAU_DIRECTORY='), 'the sign-in directory is built into the page');
assert.ok(dir.faculties.length >= 10 && dir.people.length > 100, 'every BAU faculty is in the directory');
dir.people.forEach(p => {
  Object.keys(p).forEach(k => assert.ok(allowedPerson.has(k), 'directory entry has a non-public field: ' + k));
  assert.ok(/@bau\.edu\.lb$/.test(p.email), 'directory emails are BAU addresses: ' + p.email);
  assert.ok(dir.faculties.some(f => f.id === p.faculty && f.departments.some(d => d.id === p.department)),
    'directory entry points at a real faculty and department: ' + p.email);
  assert.ok(!p.photoData || /^data:image\/(png|jpe?g|webp);base64,/.test(p.photoData), 'embedded photos are images');
});
assert.strictEqual(new Set(dir.people.map(p => p.email)).size, dir.people.length, 'one card per email');
assert.ok(!/"(roles|hash|salt|password|admin|superadmin)"\s*:/.test(JSON.stringify(dir)), 'no account data in the directory');
assert.ok(html.includes('Send invitation'), 'the authenticated People screen must include invitations');
console.log('  public directory and email-sign-in checks passed');
