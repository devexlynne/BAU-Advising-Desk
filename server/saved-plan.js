'use strict';
/* The term plan an advisor saves on a student record:
     plan: { term, courses: [{ code, crn, section }], savedAt, savedBy,
             overrides: [{ key, ruleId, course, reason, by, at }] }
   An override lets a BLOCK finding (for example a missing prerequisite) stand with a
   written reason. The server checks the shape, stamps who and when on new overrides
   itself (the browser's word is not taken for that), and reports which ones are new so
   they can be written to the audit log. */

const TERM = /^[A-Za-z0-9 /_-]{1,40}$/;
const CODE = /^[A-Z]{2,5}\d{3}[A-Z]?$/;
const short = (v, n) => String(v == null ? '' : v).slice(0, n);

function checkPlan(plan, previous, actorSlug, now) {
  if (plan == null) return { plan: undefined, added: [] };
  if (typeof plan !== 'object' || Array.isArray(plan)) return { error: 'the saved plan is not valid' };
  if (!TERM.test(String(plan.term || ''))) return { error: 'the saved plan has no valid term' };
  const courses = Array.isArray(plan.courses) ? plan.courses : [];
  if (courses.length > 20) return { error: 'a term plan can hold at most 20 courses' };
  if (courses.some(c => !c || !CODE.test(String(c.code || '')))) return { error: 'a course code in the plan is not valid' };
  const overrides = Array.isArray(plan.overrides) ? plan.overrides : [];
  if (overrides.length > 20) return { error: 'too many overrides on one plan' };
  const before = new Map(((previous && previous.overrides) || []).map(o => [o.key, o]));
  const added = [];
  const cleanOverrides = [];
  for (const o of overrides) {
    if (!o || typeof o !== 'object') return { error: 'an override is not valid' };
    const reason = short(o.reason, 500).trim();
    if (reason.length < 10) return { error: 'an override needs a reason of at least 10 characters' };
    const key = short(o.key, 400);
    const old = before.get(key);
    const clean = { key, ruleId: short(o.ruleId, 40), course: short(o.course, 12), reason,
      by: old && old.reason === reason ? old.by : actorSlug,
      at: old && old.reason === reason ? old.at : now };
    if (!old || old.reason !== reason) added.push(clean);
    cleanOverrides.push(clean);
  }
  return {
    plan: {
      term: String(plan.term),
      courses: courses.map(c => ({ code: String(c.code), crn: c.crn ? short(c.crn, 20) : null, section: short(c.section, 20) })),
      savedAt: now, savedBy: actorSlug, overrides: cleanOverrides
    },
    added
  };
}

module.exports = { checkPlan };
