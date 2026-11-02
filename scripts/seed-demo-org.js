'use strict';

const { validateTree, mergeTree } = require('../src/org-tree');

const DEMO_ORG = {
  id: 'bau',
  name: 'Beirut Arab University',
  faculties: [
    {
      id: 'business-administration',
      name: 'Faculty of Business Administration',
      departments: [{
        id: 'accounting',
        name: 'Accounting',
        programmes: [{
          id: 'bba-accounting',
          name: 'BBA Accounting',
          campuses: ['Beirut']
        }]
      }]
    },
    {
      id: 'engineering',
      name: 'Faculty of Engineering',
      departments: [{
        id: 'computer-engineering',
        name: 'Computer Engineering',
        programmes: [{
          id: 'be-computer-engineering',
          name: 'BE Computer Engineering',
          campuses: ['Debbieh']
        }]
      }]
    }
  ]
};

const DEMO_STAFF = [
  { slug: 'test-business-admin', name: 'Nadia Haddad', title: 'Demo Faculty Administrator', email: 'test.business.admin@bau.edu.lb', faculty: 'Faculty of Business Administration', department: 'Accounting', role: 'faculty-admin', scopes: ['business-administration'] },
  { slug: 'test-accounting-editor', name: 'Rami Khoury', title: 'Demo Programme Editor', email: 'test.accounting.editor@bau.edu.lb', faculty: 'Faculty of Business Administration', department: 'Accounting', role: 'programme-editor', scopes: ['bba-accounting'] },
  { slug: 'test-accounting-advisor', name: 'Maya Saleh', title: 'Demo Advisor', email: 'test.accounting.advisor@bau.edu.lb', faculty: 'Faculty of Business Administration', department: 'Accounting', role: 'advisor', scopes: ['bba-accounting'] },
  { slug: 'test-engineering-admin', name: 'Omar Faris', title: 'Demo Faculty Administrator', email: 'test.engineering.admin@bau.edu.lb', faculty: 'Faculty of Engineering', department: 'Computer Engineering', role: 'faculty-admin', scopes: ['engineering'] },
  { slug: 'test-computer-engineering-editor', name: 'Lina Nasser', title: 'Demo Programme Editor', email: 'test.computer.engineering.editor@bau.edu.lb', faculty: 'Faculty of Engineering', department: 'Computer Engineering', role: 'programme-editor', scopes: ['be-computer-engineering'] },
  { slug: 'test-computer-engineering-advisor', name: 'Sami Rahal', title: 'Demo Advisor', email: 'test.computer.engineering.advisor@bau.edu.lb', faculty: 'Faculty of Engineering', department: 'Computer Engineering', role: 'advisor', scopes: ['be-computer-engineering'] }
];

function post(baseUrl, cookie, route, payload, fetchImpl) {
  return fetchImpl(new URL(route, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(payload)
  }).then(async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'request failed: ' + route);
    return body;
  });
}

async function seedDemoOrg({ baseUrl, cookie, fetchImpl = fetch, log = console.log }) {
  if (!baseUrl || !cookie) throw new Error('BAU_DEMO_BASE_URL and BAU_DEMO_ADMIN_COOKIE are required');
  const current = await post(baseUrl, cookie, '/api/org/tree', {}, fetchImpl);
  const tree = mergeTree(current.tree, DEMO_ORG);
  const valid = validateTree(tree);
  if (!valid.ok) throw new Error(valid.error);
  await post(baseUrl, cookie, '/api/org/tree', { tree }, fetchImpl);

  const listed = await post(baseUrl, cookie, '/api/people/list', {}, fetchImpl);
  const existing = new Set((listed.people || []).map(person => person.slug));
  const invitations = [];
  for (const member of DEMO_STAFF) {
    if (existing.has(member.slug)) continue;
    const result = await post(baseUrl, cookie, '/api/people/invite', {
      person: {
        slug: member.slug,
        name: member.name,
        title: member.title,
        email: member.email,
        faculty: member.faculty,
        department: member.department,
        active: true
      },
      roles: [{ role: member.role, scopes: member.scopes }]
    }, fetchImpl);
    if (!result.inviteLink) throw new Error('test invitation did not return a local invite link');
    invitations.push({ slug: member.slug, link: result.inviteLink });
    log(member.email + ' invite: ' + result.inviteLink);
  }
  log('Demo organisation seeded; no demo student data was changed.');
  return { invitations };
}

async function main() {
  const baseUrl = process.env.BAU_DEMO_BASE_URL;
  const cookie = process.env.BAU_DEMO_ADMIN_COOKIE;
  try {
    await seedDemoOrg({ baseUrl, cookie });
  } catch (error) {
    console.error('Demo organisation seed failed:', error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { DEMO_ORG, DEMO_STAFF, seedDemoOrg };
