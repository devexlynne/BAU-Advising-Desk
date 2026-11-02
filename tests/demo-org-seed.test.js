'use strict';

const assert = require('assert');
const { DEMO_ORG, DEMO_STAFF, seedDemoOrg } = require('../scripts/seed-demo-org');
const { validateTree } = require('../src/org-tree');

async function run() {
  assert.strictEqual(validateTree(DEMO_ORG).ok, true);
  assert.strictEqual(DEMO_ORG.faculties.length, 2);
  assert.strictEqual(DEMO_STAFF.length, 6);
  assert.ok(DEMO_STAFF.every(person => person.email.startsWith('test.') && person.email.endsWith('@bau.edu.lb')));
  assert.strictEqual(DEMO_STAFF.filter(person => person.role === 'faculty-admin').length, 2);
  assert.strictEqual(DEMO_STAFF.filter(person => person.role === 'programme-editor').length, 2);
  assert.strictEqual(DEMO_STAFF.filter(person => person.role === 'advisor').length, 2);

  const calls = [];
  let tree = require('../src/org-tree').DEFAULT_TREE;
  const people = [];
  const fetchImpl = async (url, options) => {
    const route = new URL(url).pathname;
    const payload = JSON.parse(options.body);
    calls.push({ route, payload });
    let response;
    if (route === '/api/org/tree' && !payload.tree) response = { tree };
    else if (route === '/api/org/tree') {
      tree = payload.tree;
      response = { ok: true };
    } else if (route === '/api/people/list') response = { people };
    else if (route === '/api/people/invite') {
      people.push(payload.person);
      response = { inviteLink: 'https://example.invalid/verify?token=synthetic-' + payload.person.slug };
    } else throw new Error('unexpected route: ' + route);
    return { ok: true, async json() { return response; } };
  };
  const logs = [];
  const first = await seedDemoOrg({
    baseUrl: 'http://localhost:3000',
    cookie: 'bau_session=synthetic-session',
    fetchImpl,
    log: line => logs.push(line)
  });
  assert.strictEqual(first.invitations.length, DEMO_STAFF.length);
  assert.strictEqual(calls.filter(call => call.route === '/api/people/invite').length, 6);
  assert.strictEqual(logs.length, 7);
  assert.ok(logs.slice(0, 6).every(line => line.includes('https://example.invalid/verify')));

  const second = await seedDemoOrg({
    baseUrl: 'http://localhost:3000',
    cookie: 'bau_session=synthetic-session',
    fetchImpl,
    log: () => {}
  });
  assert.deepStrictEqual(second.invitations, []);
  assert.strictEqual(calls.filter(call => call.route === '/api/people/invite').length, 6,
    're-running the manual seed must not send duplicate invitations');
}

run().then(() => console.log('  demo organisation seed checks passed'))
  .catch(error => { console.error(error); process.exitCode = 1; });
