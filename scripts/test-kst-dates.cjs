// Run with pnpm test:dates. No app, database, or network access is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/caseflow/utils/date.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

function datesAt(instant) {
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [instant]));
    }
  }
  const exports = {};
  vm.runInNewContext(outputText, { exports, Date: FixedDate });
  return exports;
}

// Date getters must not depend on the PC's time zone, including DST zones.
for (const zone of ['Asia/Seoul', 'UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
  test(`KST business dates with PC time zone ${zone}`, () => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
      for (const [instant, expected] of [
        ['2026-09-20T14:59:59.999Z', '2026-09-20'],
        ['2026-09-20T15:00:00.000Z', '2026-09-21'],
        ['2026-09-20T16:00:00.000Z', '2026-09-21'],
        ['2026-09-20T23:59:59.999Z', '2026-09-21'],
        ['2026-09-21T00:00:00.000Z', '2026-09-21'],
        ['2026-12-31T15:00:00.000Z', '2027-01-01'],
      ]) {
        assert.equal(datesAt(instant).todayStr(), expected, instant);
      }

      const dates = datesAt('2026-09-20T16:00:00.000Z');
      assert.equal(dates.daysUntil('2026-09-20'), -1);
      assert.equal(dates.daysUntil('2026-09-21'), 0);
      assert.equal(dates.daysUntil('2026-09-22'), 1);
      assert.equal(dates.daysUntil(null), null);
      assert.equal(dates.formatDate('2026-09-21'), '09.21');
      assert.equal(dates.formatFullDate('2026-09-21'), '2026.09.21');
      assert.equal(dates.formatFullDate('2026-09-20T15:00:00Z'), '2026.09.21');
      assert.equal(dates.formatDateTime('2026-09-20T15:00:00Z'), '2026.09.21 00:00');
      assert.equal(dates.kstDateStr('2026-09-20T23:00:00-07:00'), '2026-09-21');
      assert.equal(dates.kstDateStr('2026-09-21'), '2026-09-21');

      // Unparseable strings (e.g. raw crawler text) must not throw.
      assert.equal(dates.kstDateStr('미정'), '미정');
      assert.equal(dates.formatFullDate('미정'), '미정');
      assert.equal(dates.formatDateTime('미정'), '미정');
      assert.equal(dates.daysUntil('미정'), null);
      assert.equal(dates.addDays('미정', 7), '미정');

      // Extension calculations across month/year ends, leap day and DST changes.
      for (const [date, days, expected] of [
        ['2026-09-30', 7, '2026-10-07'],
        ['2026-12-31', 1, '2027-01-01'],
        ['2027-01-01', -1, '2026-12-31'],
        ['2028-02-28', 1, '2028-02-29'],
        ['2028-02-29', 1, '2028-03-01'],
        ['2026-03-08', 7, '2026-03-15'],
        ['2026-11-01', 7, '2026-11-08'],
      ]) {
        assert.equal(dates.addDays(date, days), expected);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
}
