#!/usr/bin/env node
/**
 * Синхронизация веб-ассетов в offline-обёртки.
 *
 *   node scripts/sync-assets.mjs                         → android/app/src/main/assets/www/
 *   node scripts/sync-assets.mjs --out dist              → статический билд для HTTPS-хостинга
 *   node scripts/sync-assets.mjs --all                   → оба
 *   node scripts/sync-assets.mjs --check                 → только проверка дрейфа (exit 1 при расхождении)
 *
 * Игра остаётся одним index.html; здесь только копируются уже существующие файлы.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WEB_ASSETS, DIST_EXTRAS } from './web-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = p => path.join(ROOT, p);
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');

export { WEB_ASSETS, DIST_EXTRAS };

function parseArgs(argv) {
  const check = argv.includes('--check');
  const all = argv.includes('--all');
  const targets = [];
  if (argv.includes('--out')) {
    const i = argv.indexOf('--out');
    if (!argv[i + 1]) throw new Error('--out требует путь');
    targets.push(argv[i + 1]);
  } else if (argv.includes('--dist')) {
    targets.push('dist');
  } else if (!all) {
    targets.push('android/app/src/main/assets/www');
  }
  if (all) {
    targets.length = 0;
    targets.push('android/app/src/main/assets/www', 'dist');
  }
  return { check, targets };
}

export function verify(targetDir) {
  const missing = [], drift = [];
  const pairs = [...WEB_ASSETS];
  if (path.basename(targetDir) === 'dist') pairs.push(...DIST_EXTRAS);
  for (const [from, to] of pairs) {
    const a = from === '.nojekyll' ? null : src(from);
    const b = path.join(ROOT, targetDir, to);
    if (a !== null && !existsSync(a)) { missing.push(from); continue; }
    if (!existsSync(b)) { missing.push(targetDir + '/' + to); continue; }
    if (a !== null && sha(a) !== sha(b)) drift.push(targetDir + '/' + to);
  }
  return { missing, drift, ok: missing.length === 0 && drift.length === 0 };
}

function copy(targetDir) {
  const pairs = [...WEB_ASSETS];
  if (path.basename(targetDir) === 'dist') pairs.push(...DIST_EXTRAS);
  let n = 0;
  for (const [from, to] of pairs) {
    const a = from === '.nojekyll' ? null : src(from);
    const b = path.join(ROOT, targetDir, to);
    mkdirSync(path.dirname(b), { recursive: true });
    if (a === null) writeFileSync(b, '', 'utf8');
    else {
      if (!existsSync(a)) throw new Error('Нет исходника: ' + from);
      copyFileSync(a, b);
    }
    n++;
  }
  return n;
}

function main() {
  const { check, targets } = parseArgs(process.argv.slice(2));
  let bad = false;
  for (const t of targets) {
    if (check) {
      const r = verify(t);
      console.log(`${t}: ${r.ok ? 'OK' : 'ДРЕЙФ'} · отсутствует ${r.missing.length} · отличается ${r.drift.length}`);
      if (!r.ok) {
        for (const f of r.missing) console.log('  нет:  ' + f);
        for (const f of r.drift) console.log('  !=:   ' + f);
        bad = true;
      }
    } else {
      console.log(`${t}: скопировано ${copy(t)} файлов`);
    }
  }
  if (bad) process.exit(1);
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
