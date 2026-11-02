/**
 * Внедряет пулы сидов 10 уровней сложности в index.html.
 * Блок между маркерами DIFFICULTY SEEDS START/END генерируется целиком —
 * вручную его не правят. Запускать после ai/difficulty.mjs.
 *
 *   node ai/inject-seeds.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const d = JSON.parse(readFileSync(resolve('ai/difficulty.json'), 'utf8'));
if (!Array.isArray(d.levels) || d.levels.length !== 10)
  throw new Error('Ожидается 10 уровней в ai/difficulty.json');

const body = d.levels.map(l => {
  if (!Array.isArray(l.seeds) || !l.seeds.length) throw new Error('Пустой пул уровня ' + l.level);
  return '    { n:' + l.level + ', name:' + JSON.stringify(l.name) +
    ', hint:' + JSON.stringify(l.hint) +
    ', seeds:[' + l.seeds.map(s => Number(s)).join(',') + '] }';
}).join(',\n');

const block = `/* ===== DIFFICULTY SEEDS START ===== */
/* Сгенерировано из ai/difficulty.json скриптом ai/inject-seeds.mjs.
   НЕ редактировать вручную: 10 пулов сидов по измеренной сложности. */
const DIFFICULTY = {
  count: ${d.levels.length},
  defaultLevel: ${Math.ceil(d.levels.length / 2)},
  levels: [
${body}
  ]
};
/* ===== DIFFICULTY SEEDS END ===== */`;

const A = '/* ===== DIFFICULTY SEEDS START ===== */';
const B = '/* ===== DIFFICULTY SEEDS END ===== */';
const path = resolve('index.html');
const html = readFileSync(path, 'utf8');
const from = html.indexOf(A), to = html.indexOf(B);
if (from < 0 || to < 0) throw new Error('Маркеры DIFFICULTY SEEDS не найдены в index.html');
const out = html.slice(0, from) + block + html.slice(to + B.length);
if (out !== html) writeFileSync(path, out);
console.log('Внедрено уровней: ' + d.levels.length +
  ', сидов: ' + d.levels.reduce((a, l) => a + l.seeds.length, 0) +
  (out !== html ? ' (index.html обновлён)' : ' (без изменений)'));
