/* BAU address generation tests use synthetic names and IDs only. */
const assert = require('assert');
const E = require('../src/engine.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); passed++; }
  catch (e) { console.log('  FAILED  ' + name); console.log('     ' + e.message); failed++; }
}

console.log('\n--- synthetic BAU address examples ---');

test('three synthetic name parts produce the expected address', () => {
  assert.strictEqual(E.bauEmail('Test Student Example', '999900181'), 'tse018@student.bau.edu.lb');
});

test('hyphens and spaces in synthetic names are equivalent', () => {
  assert.strictEqual(
    E.bauEmail('Test Student-Example', '999900181'),
    E.bauEmail('Test Student Example', '999900181'));
});

test('missing addresses are marked as generated guesses', () => {
  assert.deepStrictEqual(E.fixEmail('Test Student Example', '999900181', ''), {
    email: 'tse018@student.bau.edu.lb',
    guessed: true
  });
});

test('existing addresses are preserved without modification', () => {
  const address = 'custom.address@student.bau.edu.lb';
  assert.deepStrictEqual(E.fixEmail('Test Student Example', '999900181', address), {
    email: address,
    guessed: false
  });
});

test('a one-word name does not produce a guessed address', () => {
  assert.strictEqual(E.bauEmail('Example', '999900181'), null);
  assert.deepStrictEqual(E.fixEmail('Example', '999900181', ''), { email: '', guessed: false });
});

console.log('\n========================================================');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
console.log('========================================================\n');
process.exit(failed ? 1 : 0);
