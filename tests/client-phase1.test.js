'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, ['build.js'], { cwd: root, stdio: 'ignore' });
const html = fs.readFileSync(path.join(root, 'build', 'index.html'), 'utf8');

assert.ok(!html.includes('window.FACULTY='), 'public HTML must not include the staff directory');
assert.ok(!html.includes('data-pick='), 'public sign-in must not render a staff-name picker');
assert.ok(html.includes('BAU email'), 'the sign-in screen must ask for a BAU email');
assert.ok(html.includes('Send invitation'), 'the authenticated People screen must include invitations');
console.log('  public staff-directory and email-sign-in checks passed');
