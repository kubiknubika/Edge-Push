/**
 * Подбор сидов для 10 уровней сложности.
 *
 *   node ai/difficulty.mjs [--count 500] [--start 20001] [--per-level 12] [--workers 2]
 *
 * Сложность НЕ меняет механику: меняется только то, какой сид выдаётся игроку.
 * Для каждого сида-кандидата измеряем:
 *   • как далеко заходит эволюционировавшая политика БЕЗ поиска (policyFloors),
 *   • сколько состояний генератор перебрал, чтобы подтвердить выигрышную
 *     линию первого этажа (guard1 — мера «неочевидности» решения),
 *   • сколько попыток/какая ширина луча нужны решателю для победы
 *     (solverAttempts / solverWidth),
 *   • остаток HP и длину забега реактивной политики.
 * Сводим в нормализованный балл 0..1, сортируем и делим на 10 децилей.
 * Из каждого дециля берём равномерно 12 сидов — это пул уровня.
 * В пулы попадают только сиды, которые решатель реально выиграл.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { DEFAULT_PLAN } from './solver.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}
const count = arg('count', 500);
const start = arg('start', 20001);
const perLevel = arg('per-level', 12);
const workers = arg('workers', 2);
const LEVELS = 10;

const training = JSON.parse(readFileSync(resolve('ai/training.json'), 'utf8'));
const champion = training.champion;
const candidates = Array.from({ length: count }, (_, i) => start + i);

const NAMES = [
  'ПРОГУЛКА', 'РАЗМИНКА', 'УВЕРЕННО', 'СЕРЬЁЗНО', 'НОРМА',
  'ОСТРО', 'ЖЁСТКО', 'БЕЗЖАЛОСТНО', 'ПРЕДЕЛ', 'КРАЙ'
];

const WEIGHTS = {
  hardPolicy: 0.35,   // реактивная политика далеко не зашла → сложно
  hardPlan: 0.15,     // решатель без победы тоже застревает
  width: 0.20,        // нужна большая ширина луча
  attempts: 0.10,     // нужно несколько вариантов ранжирования
  obscure: 0.12,      // выигрышная линия первого этажа неочевидна
  attrition: 0.08     // герой теряет HP
};

function measureAll(seeds) {
  const jobs = seeds.map((seed, index) => ({ seed, index }));
  return new Promise((resolve, reject) => {
    const results = new Array(seeds.length);
    let cursor = 0, done = 0, failed = false;
    const pool = [];
    for (let i = 0; i < Math.min(workers, jobs.length); i++) {
      const w = new Worker(new URL('./difficulty-worker.mjs', import.meta.url), {
        workerData: { champion, plan: DEFAULT_PLAN }
      });
      pool.push(w);
      w.on('error', e => { failed = true; reject(e); });
      const dispatch = () => {
        if (cursor < jobs.length) w.postMessage(jobs[cursor++]);
        else w.terminate();
      };
      w.on('message', msg => {
        results[msg.index] = msg;
        done++;
        if (done % 50 === 0 || done === seeds.length)
          console.log(`  измерено ${done}/${seeds.length}`);
        if (!failed) dispatch();
        if (done === seeds.length) resolve(results);
      });
      dispatch();
    }
    if (!jobs.length) resolve([]);
  });
}

const t0 = Date.now();
console.log(`ЗАМЕР СЛОЖНОСТИ: ${count} сидов ${start}…${start + count - 1}, ${workers} потока`);
const raw = await measureAll(candidates);
console.log(`Измерение: ${((Date.now() - t0) / 1000).toFixed(1)}с`);

const rows = raw.filter(Boolean).map(r => ({ seed: r.seed, ...r.metrics }));
const winnable = rows.filter(r => r.solverWin);
const excluded = rows.length - winnable.length;

const clamp01 = x => Math.max(0, Math.min(1, x));
const log2 = x => Math.log2(Math.max(1, x));
for (const r of winnable) {
  r.hardPolicy = (7 - r.policyFloors) / 7;
  r.hardPlan = (7 - r.solverFloors) / 7;
  r.width = clamp01(log2((r.solverWidth || 96) / 96) / 3);
  r.attempts = clamp01((r.solverAttempts - 1) / 5);
  r.obscure = clamp01(log2((r.guard1 || 60) / 60) / 5);
  r.attrition = clamp01((3 - r.policyHp) / 3);
  r.score = +(
    WEIGHTS.hardPolicy * r.hardPolicy + WEIGHTS.hardPlan * r.hardPlan +
    WEIGHTS.width * r.width + WEIGHTS.attempts * r.attempts +
    WEIGHTS.obscure * r.obscure + WEIGHTS.attrition * r.attrition
  ).toFixed(5);
}
winnable.sort((a, b) => a.score - b.score || a.seed - b.seed);

const median = arr => {
  const s = arr.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const levelBand = picks =>
  picks[0].score.toFixed(2) + '–' + picks[picks.length - 1].score.toFixed(2);
const bucket = Math.floor(winnable.length / LEVELS);
const levels = [];
for (let L = 1; L <= LEVELS; L++) {
  const from = (L - 1) * bucket;
  const to = L === LEVELS ? winnable.length : L * bucket;
  const part = winnable.slice(from, to);
  const picks = [];
  for (let i = 0; i < perLevel; i++) {
    const idx = from + Math.min(part.length - 1, Math.floor((i + 0.5) * part.length / perLevel));
    picks.push(winnable[idx]);
  }
  const mPolicy = median(picks.map(x => x.policyFloors));
  const mWidth = median(picks.map(x => x.solverWidth));
  const mAttempts = median(picks.map(x => x.solverAttempts));
  const mGuard = median(picks.map(x => x.guard1));
  levels.push({
    level: L, name: NAMES[L - 1],
    hint: `без поиска ${mPolicy}/7 · балл ${levelBand(picks)}`,
    scoreMin: picks[0].score, scoreMax: picks[picks.length - 1].score,
    medianScore: median(picks.map(x => x.score)),
    median: {
      policyFloors: mPolicy, solverWidth: mWidth,
      solverAttempts: mAttempts, guard1: mGuard
    },
    seeds: picks.map(x => x.seed),
    seedCount: picks.length,
    bucketSize: part.length
  });
}

const difficulty = {
  generatedAt: new Date().toISOString(),
  method: 'отбор сидов по измеренной сложности; механика игры не меняется',
  config: {
    candidateSeeds: [start, start + count - 1], candidates: count,
    levels: LEVELS, perLevel, workers, maxTurns: 90,
    verifiedBy: 'solve() с DEFAULT_PLAN, exhaustive:false',
    winnable: winnable.length, excluded
  },
  metric: {
    description: 'нормализованный балл 0..1: глубина реактивной политики без поиска, ' +
                 'ширина/число попыток решателя, неочевидность линии первого этажа, потеря HP',
    weights: WEIGHTS,
    deciles: 'кандидаты отсортированы по баллу и разделены на 10 равных децилей; ' +
             'из каждого равномерно взято по 12 сидов'
  },
  names: NAMES,
  levels,
  perSeed: winnable.map(r => ({
    seed: r.seed, score: r.score, policyFloors: r.policyFloors,
    solverAttempts: r.solverAttempts, solverWidth: r.solverWidth,
    solverTurns: r.solverTurns, guard1: r.guard1, policyHp: r.policyHp
  })),
  seconds: +((Date.now() - t0) / 1000).toFixed(1)
};

writeFileSync(resolve('ai/difficulty.json'), JSON.stringify(difficulty, null, 2));
console.log('\nУРОВНИ СЛОЖНОСТИ');
for (const l of levels) {
  console.log(`  ${String(l.level).padStart(2)} ${l.name.padEnd(12)} ` +
    `балл ${l.scoreMin.toFixed(3)}–${l.scoreMax.toFixed(3)} · ${l.hint} · сидов ${l.seedCount}`);
}
console.log(`Проходимых ${winnable.length}/${rows.length}, исключено ${excluded}`);
console.log(`Время: ${difficulty.seconds}с. Данные: ai/difficulty.json`);
