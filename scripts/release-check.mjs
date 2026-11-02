#!/usr/bin/env node
/** npm run release:check — preparedness gate перед сборкой AAB/APK. */
import { collectChecks } from './release-lib.mjs';

const checks = collectChecks();
let failed = 0;
for (const c of checks) {
  const mark = c.ok ? '[ OK ]' : '[FAIL]';
  console.log(`${mark} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  if (!c.ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} проверок пройдено`);
if (failed) {
  console.error('Релиз НЕ готов: исправьте FAIL и запустите проверку снова.');
  process.exit(1);
}
console.log('Релизный комплект готов к сборке (бинарник собирается в Android Studio).');
