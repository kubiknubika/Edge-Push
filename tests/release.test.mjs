/** Релизный gate: каждый пункт collectChecks() обязан быть зелёным. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectChecks } from '../scripts/release-lib.mjs';

const checks = collectChecks();

test('release-check собрал достаточно проверок', () => {
  assert.ok(checks.length >= 35, 'всего проверок: ' + checks.length);
});

for (const c of checks) {
  test(c.name, () => {
    assert.ok(c.ok, c.detail || 'проверка не прошла');
  });
}
