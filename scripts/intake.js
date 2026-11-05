#!/usr/bin/env node
/*
 * Checks a filled faculty set-up workbook without loading anything.
 *
 *   node scripts/intake.js "BAU set-up - Faculty of Science.xlsx" [--json out.json]
 *
 * Prints what would be added or changed, every error that would stop the load
 * and every warning someone should read. With --json it also writes the
 * structure, study plans, rule values and staff list it read, for a review.
 * The real load is done from University structure > Load a faculty workbook.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Intake = require('../src/intake');

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: node scripts/intake.js <workbook.xlsx> [--json out.json]'); process.exit(2); }
  const jsonAt = args.indexOf('--json');
  const book = await Intake.readWorkbook(fs.readFileSync(file), bytes => zlib.inflateRawSync(bytes));
  let tree = null;
  try { tree = require('../data/catalogue-2020.json').tree; } catch (e) { /* use the built-in tree */ }
  const known = require('../data/catalog.json').universityElectives.map(c => c.code);
  const got = Intake.fromWorkbook(book, { tree, known, fileName: path.basename(file) });
  const r = got.report;
  console.log('\n' + (got.facultyName || 'Unknown faculty'));
  Object.keys(got.plans || {}).forEach(id => {
    const p = got.plans[id];
    console.log('  ' + id.padEnd(28) + String(p.courses.length).padStart(4) + ' courses  ' + String(p.totalCredits).padStart(4) + ' credits'
      + (got.rules[id] ? '  ' + Object.keys(got.rules[id]).length + ' rule value(s)' : '') + (p.needsReview ? '  to check' : ''));
  });
  if (got.people) console.log('  ' + got.people.length + ' staff to invite');
  const show = (title, list) => { if (list.length) { console.log('\n' + title + ' (' + list.length + ')'); list.forEach(x => console.log('  - ' + x)); } };
  show('Changes', r.notes);
  show('Warnings', r.warnings);
  show('Errors: these stop the load', r.errors);
  if (jsonAt >= 0 && args[jsonAt + 1]) {
    fs.writeFileSync(args[jsonAt + 1], JSON.stringify(got, null, 2));
    console.log('\nWritten to ' + args[jsonAt + 1]);
  }
  console.log('\n' + (r.errors.length ? 'Not ready to load.' : 'Ready to load.'));
  process.exit(r.errors.length ? 1 : 0);
}
main().catch(e => { console.error(e.message); process.exit(2); });
