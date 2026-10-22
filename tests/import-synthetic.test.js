const assert = require('assert');
const PdfImport = require('../src/pdfimport.js');

function word(text, x, y) {
  return { text, x, y, w: String(text).length * 7 };
}

const transcript = { width: 800, height: 1000, words: [
  word('Name:', 0, 10), word('Test', 45, 10), word('Student', 80, 10),
  word('Example', 130, 10), word('Nationality:', 250, 10), word('TEST', 330, 10),
  word('ID', 0, 30), word('999123456', 20, 30), word('Faculty', 100, 30),
  word('of:', 150, 30), word('Science', 175, 30), word('Bachelor', 240, 30),
  word('in', 300, 30), word('Computer', 320, 30), word('Science', 390, 30),
  word('Admission', 0, 50), word('Year:', 70, 50), word('2024/2025', 110, 50),
  word('Code', 0, 70), word('Course', 60, 70),
  word('FALL', 0, 90), word('2024/2025', 40, 90),
  word('CMPS241', 0, 110), word('Synthetic', 60, 110), word('Course', 125, 110),
  word('3', 200, 110), word('B', 220, 110), word('3', 240, 110)
] };

const schedule = { width: 800, height: 1000, words: [
  word('999123456', 0, 10),
  word('Test Student Example', 0, 30),
  word('202710', 0, 50),
  word('CRN', 0, 70), word('Course', 50, 70), word('Sec', 150, 70),
  word('Credit', 200, 70), word('Monday', 300, 70),
  word('12345', 0, 90), word('CMPS241', 50, 90), word('B1', 150, 90),
  word('3', 200, 90), word('0900', 300, 90), word('1100', 350, 90),
  word('Total Number of Credits:', 0, 110), word('3', 160, 110)
] };

const transcriptResult = PdfImport.parseTranscripts([transcript]);
assert.deepStrictEqual(transcriptResult.skipped, []);
assert.strictEqual(transcriptResult.students.length, 1);
assert.strictEqual(transcriptResult.students[0].id, '999123456');
assert.strictEqual(transcriptResult.students[0].name, 'Test Student Example');
assert.strictEqual(transcriptResult.students[0].history[0].code, 'CMPS241');

const scheduleResult = PdfImport.parseSchedules([schedule]);
assert.deepStrictEqual(scheduleResult.skipped, []);
assert.strictEqual(scheduleResult.registrations.length, 1);
assert.strictEqual(scheduleResult.registrations[0].id, '999123456');
assert.strictEqual(scheduleResult.registrations[0].courses[0].code, 'CMPS241');
assert.strictEqual(scheduleResult.registrations[0].courses[0].cr, 3);
assert.strictEqual(scheduleResult.registrations[0].courses[0].meetings[0].day, 'MON');

console.log('  ok  transcript and schedule parsers accept synthetic student data');
