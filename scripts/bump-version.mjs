#!/usr/bin/env node
/**
 * Поднимает версию во всех связанных местах и пересинхронизирует ассеты.
 *
 *   npm run version:bump 1.0.1
 *
 * Меняет: package.json, package-lock.json, android/app/build.gradle (versionName +
 * versionCode+1), sw.js (CACHE_NAME), store/release-notes.md (новая секция),
 * а также упоминания старой версии в документах. Затем --all для APK/dist.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = p => path.join(ROOT, p);
const read = p => readFileSync(abs(p), 'utf8');
const write = (p, s) => writeFileSync(abs(p), s, 'utf8');
const json = p => JSON.parse(read(p));

const next = process.argv[2];
if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('Использование: npm run version:bump 1.0.1');
  process.exit(1);
}

const pkg = json('package.json');
const old = pkg.version;
pkg.version = next;
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

const lock = json('package-lock.json');
lock.version = next;
if (lock.packages && lock.packages['']) lock.packages[''].version = next;
write('package-lock.json', JSON.stringify(lock, null, 2) + '\n');

let gradle = read('android/app/build.gradle');
gradle = gradle.replace(/versionName '[^']*'/, `versionName '${next}'`);
gradle = gradle.replace(/versionCode (\d+)/, (m, n) => `versionCode ${Number(n) + 1}`);
write('android/app/build.gradle', gradle);

let sw = read('sw.js');
sw = sw.replace(/const CACHE_NAME = CACHE_PREFIX \+ '[^']*'/,
  `const CACHE_NAME = CACHE_PREFIX + '${next}'`);
write('sw.js', sw);

const date = new Date().toISOString().slice(0, 10);
const notes = read('store/release-notes.md');
write('store/release-notes.md',
  `## ${next} · ${date}\n\n_Заполните изменения перед релизом._\n\n` + notes);

const docs = [
  'RELEASE.md', 'README.md',
  'store/listing-ru.md', 'store/listing-en.md', 'store/data-safety.md',
  'store/privacy-policy.md', 'store/privacy-policy.html', 'store/README.md'
];
for (const f of docs) {
  if (!read(f).includes(old)) continue;
  write(f, read(f).split(old).join(next));
}

execFileSync(process.execPath, [abs('scripts/sync-assets.mjs'), '--all'], { stdio: 'inherit' });
console.log(`Версия ${old} → ${next}; versionCode увеличен; кэш SW обновлён; ассеты пересинхронизированы.`);
