'use strict';

const { isWithin } = require('./org-tree');

const SCOPED_ACTIONS = {
  'people:read': ['superadmin', 'faculty-admin', 'programme-editor', 'approver', 'advisor', 'viewer'],
  'people:manage': ['superadmin', 'faculty-admin'],
  'students:read': ['superadmin', 'faculty-admin', 'programme-editor', 'approver', 'advisor', 'viewer'],
  'students:write': ['superadmin', 'faculty-admin', 'advisor'],
  'students:clear': ['superadmin', 'faculty-admin'],
  'rules:write': ['superadmin', 'faculty-admin', 'programme-editor']
};

const GLOBAL_ACTIONS = {
  'offering:read': ['superadmin', 'faculty-admin', 'programme-editor', 'approver', 'advisor', 'viewer'],
  'offering:write': ['superadmin', 'faculty-admin'],
  'brand:read': ['superadmin', 'faculty-admin', 'programme-editor', 'approver', 'advisor', 'viewer'],
  'brand:write': ['superadmin'],
  'org:read': ['superadmin', 'faculty-admin', 'programme-editor', 'approver', 'advisor', 'viewer'],
  'org:write': ['superadmin'],
  'ideas:read': ['superadmin', 'faculty-admin', 'programme-editor', 'approver', 'advisor', 'viewer'],
  'ideas:write': ['superadmin', 'faculty-admin', 'programme-editor', 'approver', 'advisor', 'viewer']
};

function can(person, action, scopeNode, tree, bootstrapSuperadmins = []) {
  if (!person || person.active === false) return false;
  const slug = String(person.slug || '');
  const assignments = Array.isArray(person.roles) ? person.roles : [];
  if (bootstrapSuperadmins.map(String).includes(slug)) return true;

  const globalRoles = GLOBAL_ACTIONS[action];
  if (globalRoles) return assignments.some(assignment =>
    assignment && globalRoles.includes(assignment.role));

  const allowedRoles = SCOPED_ACTIONS[action];
  if (!allowedRoles || typeof scopeNode !== 'string' || !scopeNode) return false;
  return assignments.some(assignment => {
    if (!assignment || !allowedRoles.includes(assignment.role)) return false;
    if (assignment.role === 'superadmin') return true;
    const scopes = Array.isArray(assignment.scopes) ? assignment.scopes : [];
    return scopes.some(scope => isWithin(tree, scope, scopeNode));
  });
}

function isSuperadmin(person, bootstrapSuperadmins = []) {
  return !!person && person.active !== false
    && (bootstrapSuperadmins.map(String).includes(String(person.slug || ''))
      || (Array.isArray(person.roles) && person.roles.some(assignment =>
        assignment && assignment.role === 'superadmin')));
}

module.exports = { can, isSuperadmin };
