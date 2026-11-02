'use strict';

const clone = value => JSON.parse(JSON.stringify(value));

const DEFAULT_TREE = {
  id: 'bau',
  name: 'Beirut Arab University',
  faculties: [{
    id: 'science',
    name: 'Faculty of Science',
    departments: [{
      id: 'mathematics-and-computer-science',
      name: 'Mathematics and Computer Science',
      programmes: [{
        id: 'cs',
        name: 'BSc Computer Science',
        campuses: ['Beirut', 'Debbieh']
      }]
    }]
  }]
};

function childrenOf(node) {
  if (!node || typeof node !== 'object') return [];
  return ['faculties', 'departments', 'programmes']
    .flatMap(key => Array.isArray(node[key]) ? node[key] : []);
}

function allNodes(tree) {
  const out = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    out.push(node);
    childrenOf(node).forEach(visit);
  };
  visit(tree);
  return out;
}

function validateTree(tree) {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)
    || tree.id !== 'bau' || typeof tree.name !== 'string' || !tree.name.trim()
    || !Array.isArray(tree.faculties)) {
    return { ok: false, error: 'the organisation tree must start with the bau university node' };
  }
  const seen = new Set();
  function visit(node, kind) {
    if (!node || typeof node !== 'object' || Array.isArray(node)
      || typeof node.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(node.id)
      || typeof node.name !== 'string' || !node.name.trim()) {
      return 'each organisation node needs a slug id and name';
    }
    if (seen.has(node.id)) return 'organisation node ids must be unique';
    seen.add(node.id);
    if (node.nameAr !== undefined && typeof node.nameAr !== 'string') {
      return 'Arabic organisation names must be strings';
    }
    if (kind === 'programme') {
      if (node.faculties !== undefined || node.departments !== undefined
        || (node.campuses !== undefined && (!Array.isArray(node.campuses)
          || node.campuses.some(campus => typeof campus !== 'string' || !campus.trim())))) {
        return 'programme nodes may only have a campuses list';
      }
      return null;
    }
    const childKey = kind === 'university' ? 'faculties'
      : kind === 'faculty' ? 'departments' : 'programmes';
    if (!Array.isArray(node[childKey])) return 'organisation nodes need a ' + childKey + ' list';
    if (node.campuses !== undefined) return 'campuses belong on programme nodes';
    if (kind !== 'university' && node.faculties !== undefined) return 'only the university has faculties';
    if (kind === 'department' && node.departments !== undefined) return 'departments cannot contain departments';
    for (const child of node[childKey]) {
      const error = visit(child, kind === 'university' ? 'faculty'
        : kind === 'faculty' ? 'department' : 'programme');
      if (error) return error;
    }
    return null;
  }
  const error = visit(tree, 'university');
  return error ? { ok: false, error } : { ok: true };
}

function findNode(tree, id) {
  return allNodes(tree).find(node => node.id === id) || null;
}

function isWithin(tree, scopeId, targetId) {
  if (scopeId === targetId) return !!findNode(tree, scopeId);
  const scope = findNode(tree, scopeId);
  if (!scope) return false;
  const contains = node => node.id === targetId || childrenOf(node).some(contains);
  return childrenOf(scope).some(contains);
}

function mergeTree(base, additions) {
  const merged = clone(base);
  const valid = validateTree(additions);
  if (!valid.ok) throw new Error(valid.error);
  const mergeChildren = (target, source, key) => {
    target[key] = Array.isArray(target[key]) ? target[key] : [];
    for (const child of source[key] || []) {
      const existing = target[key].find(node => node.id === child.id);
      if (!existing) target[key].push(clone(child));
      else if (key === 'faculties') mergeChildren(existing, child, 'departments');
      else if (key === 'departments') mergeChildren(existing, child, 'programmes');
    }
  };
  mergeChildren(merged, additions, 'faculties');
  const result = validateTree(merged);
  if (!result.ok) throw new Error(result.error);
  return merged;
}

function migrateStore(store, faculty, adminSlugs) {
  let changed = false;
  let seededTree = false;
  let importedPeople = [];
  if (!Object.prototype.hasOwnProperty.call(store, 'org/tree')) {
    store['org/tree'] = clone(DEFAULT_TREE);
    changed = true;
    seededTree = true;
  }
  const existingPeople = Object.keys(store).some(key => /^people\/[^/]+$/.test(key));
  if (!existingPeople) {
    const bootstrap = new Set((adminSlugs || []).map(String));
    for (const member of faculty || []) {
      if (!member || typeof member.slug !== 'string' || !/^[a-z0-9-]+$/.test(member.slug)) continue;
      const account = store['advisors/' + member.slug + '/account'];
      const role = bootstrap.has(member.slug) || member.admin ? 'superadmin' : 'advisor';
      const scopes = role === 'superadmin' ? ['bau'] : ['cs'];
      store['people/' + member.slug] = {
        slug: member.slug,
        name: String(member.name || ''),
        title: String(member.title || ''),
        email: String(member.email || '').trim().toLowerCase(),
        photo: member.photo || '',
        faculty: String(member.faculty || ''),
        department: String(member.department || ''),
        short: String(member.short || ''),
        rank: String(member.rank || ''),
        ...(member.honorific !== undefined ? { honorific: member.honorific } : {}),
        keepOnBulkClear: !!member.keepOnBulkClear,
        active: true,
        verified: !!account && account.verified !== false,
        roles: [{ role, scopes }]
      };
      importedPeople.push(member.slug);
    }
    if (importedPeople.length) changed = true;
  }
  return { changed, seededTree, importedPeople };
}

module.exports = {
  DEFAULT_TREE,
  allNodes,
  findNode,
  isWithin,
  mergeTree,
  migrateStore,
  validateTree
};
