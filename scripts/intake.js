#!/usr/bin/env node
/*
 * Checks filled study-plan files without loading anything.
 *
 *   node scripts/intake.js "BSc Computer Science.xlsx" [more files...]
 *
 * For each file: what would be added or changed, every error that would stop
 * the load and every warning someone should read. The real load is done from
 * University structure > Load study-plan files.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Intake = require('../src/intake');

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node scripts/intake.js <file.xlsx> [more files...]'); process.exit(2); }
  let tree = null;
  try { tree = require('../data/catalogue-2020.json').tree; } catch (e) { /* use the built-in tree */ }
  const known = require('../data/catalog.json').universityElectives.map(c => c.code);
  let bad = 0;
  for (const file of files) {
    const book = await Intake.readWorkbook(fs.readFileSync(file), bytes => zlib.inflateRawSync(bytes));
    const got = Intake.fromWorkbook(book, { tree, known, fileName: path.basename(file) });
    const r = got.report;
    const p = got.plan;
    console.log('\n' + path.basename(file) + (p ? ': ' + p.courses.length + ' courses, ' + p.totalCredits + ' credits'
      + (Object.keys(got.rules).length ? ', ' + Object.keys(got.rules).length + ' rule value(s)' : '') + (got.people.length ? ', ' + got.people.length + ' staff' : '') : ''));
    const show = (title, list) => list.forEach(x => console.log('  ' + title + ' ' + x));
    show('change ', r.notes);
    show('warning', r.warnings);
    show('ERROR  ', r.errors);
    console.log('  ' + (r.errors.length ? 'not ready' : 'ready to load'));
    if (r.errors.length) bad++;
  }
  process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e.message); process.exit(2); });
