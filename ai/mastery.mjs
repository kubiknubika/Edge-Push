/**
 * Проверка «уверенной победы»: не случайное прохождение, а воспроизводимые 100%.
 *
 *   node ai/mastery.mjs [--seeds 100] [--fresh 4001] [--workers 2]
 *
 * Две выборки сидов, которых эволюция и калибровка никогда не видели:
 *   A = 1001..1100  (исходный тест),
 *   B = 4001..4100  (совершенно новая выборка, нигде не использовалась).
 * Дополнительно: абляция (тот же поиск без выученных весов) и повторный прогон
 * для доказательства детерминированности. Сиды решаются в двух рабочих потоках.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { genomeFromJSON, genomeToJSON, emptyGenome, heuristicGenome, randomGenome } from './policy.mjs';
import { E, makeRng } from './engine.mjs';
import { solve, DEFAULT_PLAN } from './solver.mjs';
import { parallelSolveSet } from './parallel.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}
const n = arg('seeds', 100);
const freshStart = arg('fresh', 4001);
const workers = arg('workers', 2);
const MAX_TURNS = 90;
const setA = Array.from({ length: n }, (_, i) => 1001 + i);
const setB = Array.from({ length: n }, (_, i) => freshStart + i);

const training = JSON.parse(readFileSync(resolve('ai/training.json'), 'utf8'));
const championJSON = training.champion;
const champion = genomeFromJSON(championJSON);
const baselines = [
  ['Чемпион (60 поколений)', championJSON],
  ['Поколение 0', training.initialBest],
  ['Жадная эвристика', genomeToJSON(heuristicGenome())],
  ['Нулевые веса (нет обучения)', genomeToJSON(emptyGenome())],
  ['Случайные веса', genomeToJSON(randomGenome(makeRng(4242)))]
];

const t0 = Date.now();
function stats(rows) {
  const wins = rows.filter(r => r.win).length;
  const winnable = rows.filter(r => !r.unwinnable);
  const winnableWins = winnable.filter(r => r.win).length;
  const byWidth = {}, byRank = {};
  for (const r of rows) {
    if (!r.win) continue;
    byWidth[r.width] = (byWidth[r.width] || 0) + 1;
    byRank[r.rank] = (byRank[r.rank] || 0) + 1;
  }
  return {
    seeds: rows.length, wins, winRate: +(wins / rows.length).toFixed(3),
    avgAttempts: +(rows.reduce((a, b) => a + b.attempts, 0) / rows.length).toFixed(2),
    maxAttempts: Math.max(...rows.map(r => r.attempts)),
    byWidth, byRank,
    winnableSeeds: winnable.length, winnableWins,
    winnableWinRate: winnable.length ? +(winnableWins / winnable.length).toFixed(3) : 1,
    unwinnable: rows.filter(r => r.unwinnable).map(r => ({
      seed: r.seed, blockedAt: r.blockedAt, proofStates: r.proofStates
    })),
    unsolved: rows.filter(r => !r.win && !r.unwinnable).map(r => ({ seed: r.seed, maxFloors: r.maxFloors }))
  };
}

const BASE_OPTS = { plan: DEFAULT_PLAN, maxTurns: MAX_TURNS, branch: 13, workers };

async function runSet(name, seeds) {
  console.log(`\n=== ${name}: ${seeds[0]}…${seeds[seeds.length - 1]} (${seeds.length} сидов, ${workers} потока) ===`);
  let winsSoFar = 0;
  const { rows } = await parallelSolveSet(seeds, championJSON, {
    ...BASE_OPTS,
    onResult: (r, done, total) => {
      if (r.win) winsSoFar++;
      if (r.attempts > 1) console.log(`  сид ${r.seed}: ${r.win ? 'ПОБЕДА' : 'НЕ РЕШЁН'} за ${r.attempts} попыток (W=${r.width}, ${r.rank})`);
      if (done % 20 === 0 || done === total) console.log(`  ${done}/${total} — побед ${winsSoFar}`);
    }
  });
  const s = stats(rows);
  console.log(`ИТОГ ${name}: ${s.wins}/${s.seeds} всех сидов, ` +
              `${s.winnableWins}/${s.winnableSeeds} проходимых (${(s.winnableWinRate * 100).toFixed(0)}%), ` +
              `ср. попыток ${s.avgAttempts}, макс ${s.maxAttempts}`);
  if (s.unwinnable.length) console.log('  ДОКАЗАННО НЕПРОХОДИМЫ:', JSON.stringify(s.unwinnable));
  if (s.unsolved.length) console.log('  НЕ РЕШЕНЫ:', JSON.stringify(s.unsolved));
  return { summary: s, rows };
}

const A = await runSet('ВЫБОРКА A', setA);
const B = await runSet('ВЫБОРКА B', setB);

/* --- абляция: тот же дешёвый поиск, но без выученной оценки --- */
const hardSeeds = [...A.rows, ...B.rows]
  .filter(r => r.attempts > 1 && !r.unwinnable).map(r => r.seed).slice(0, 20);
const ablSeeds = hardSeeds.length >= 8 ? hardSeeds : setA.slice(0, 25);
const cheapOpts = {
  plan: [{ width: 384, ranks: ['base'] }], maxTurns: MAX_TURNS, branch: 13,
  workers, exhaustive: false
};
console.log(`\n=== АБЛЯЦИЯ: один луч W=384 на ${ablSeeds.length} трудных сидах ===`);
const ablation = [];
for (const [name, g] of baselines) {
  const { rows } = await parallelSolveSet(ablSeeds, g, cheapOpts);
  const s = stats(rows);
  ablation.push({ name, wins: s.wins, seeds: s.seeds, winRate: s.winRate });
  console.log(`  ${name.padEnd(30)} ${s.wins}/${s.seeds} (${(s.winRate * 100).toFixed(0)}%)`);
}

/* --- воспроизводимость: два независимых прогона дают один результат --- */
const probe = [1023, 1040, 1052, setA[0], setB[0]];
const fingerprint = rows => createHash('sha256').update(JSON.stringify(rows.map(r => ({
  seed: r.seed, win: r.win, attempts: r.attempts, width: r.width,
  rank: r.rank, turns: r.turns, maxFloors: r.maxFloors
})))).digest('hex').slice(0, 16);
const reproOpts = { ...BASE_OPTS, exhaustive: false };
const r1 = (await parallelSolveSet(probe, championJSON, reproOpts)).rows;
const r2 = (await parallelSolveSet(probe, championJSON, reproOpts)).rows;
const reproducibility = {
  seeds: probe, hash1: fingerprint(r1), hash2: fingerprint(r2),
  identical: fingerprint(r1) === fingerprint(r2),
  allWins: r1.every(r => r.win)
};
console.log(`\nВОСПРОИЗВОДИМОСТЬ: ${reproducibility.hash1} / ${reproducibility.hash2} → ` +
            (reproducibility.identical ? 'идентично' : 'РАСХОЖДЕНИЕ'));

/* --- реплей: сид, который чистая политика проиграла, а solver выиграл --- */
const pure = JSON.parse(readFileSync(resolve('ai/results.json'), 'utf8'));
const pureLose = pure.perPolicyRows[pure.policies[3].name].filter(r => !r.win).map(r => r.seed);
const replaySeed = pureLose.find(s => A.rows.some(r => r.seed === s && r.win)) || A.rows[0].seed;
const solvedReplay = solve(replaySeed, champion, {
  plan: DEFAULT_PLAN, maxTurns: MAX_TURNS, branch: 13, exhaustive: false
});

/* --- замер гарантии проходимости генератора (у воркеров свой vm) --- */
const guardBefore = Object.assign({}, E.guardStats);
const guardSeeds = 40;
for (let seed = 9001; seed < 9001 + guardSeeds; seed++) {
  let s = E.createGame(seed);
  for (let floor = 2; floor <= E.MAX_FLOOR; floor++) {
    s.phase = 'PERKS';
    s.perkChoices = E.choosePerkCards(s);
    s = E.choosePerk(s, s.perkChoices[0]);
  }
}
const generatorGuard = {
  seeds: guardSeeds, floors: guardSeeds * E.MAX_FLOOR,
  checked: E.guardStats.checked - guardBefore.checked,
  rejected: E.guardStats.rejected - guardBefore.rejected,
  maxAttempts: E.guardStats.maxAttempts,
  cacheHits: E.guardStats.cacheHits - guardBefore.cacheHits,
  failed: E.guardStats.failed || 0,
  method: 'перебор состояний этажа до PERKS/WIN, тупиковые расклады перегенерируются'
};
console.log(`\nГЕНЕРАТОР: проверено ${generatorGuard.checked} раскладов, ` +
            `отбраковано ${generatorGuard.rejected}, ошибок ${generatorGuard.failed}`);

const mastery = {
  generatedAt: new Date().toISOString(),
  method: 'детерминированный адаптивный поиск лучом; обучение политики проверяется отдельно',
  config: {
    seedSetA: [setA[0], setA[setA.length - 1]],
    seedSetB: [setB[0], setB[setB.length - 1]],
    seedsPerSet: n, maxTurns: MAX_TURNS, branch: 13, workers,
    plan: DEFAULT_PLAN,
    disjoint: 'A и B не пересекаются с пулом обучения (11…787) и калибровкой (2001…2016)',
    generatorFix: 'каждый этаж проверяется на проходимость, тупиковые расклады перегенерируются'
  },
  setA: A, setB: B,
  totalWins: A.summary.wins + B.summary.wins,
  totalSeeds: A.summary.seeds + B.summary.seeds,
  winnableWins: A.summary.winnableWins + B.summary.winnableWins,
  winnableSeeds: A.summary.winnableSeeds + B.summary.winnableSeeds,
  unwinnableSeeds: [...A.summary.unwinnable, ...B.summary.unwinnable],
  verdict: (A.summary.winnableWins === A.summary.winnableSeeds &&
            B.summary.winnableWins === B.summary.winnableSeeds)
    ? 'CONFIDENT_100' : 'PARTIAL',
  ablation,
  reproducibility,
  generatorGuard,
  replay: {
    seed: replaySeed, source: 'детерминированный решатель',
    purePolicyLost: pureLose.includes(replaySeed),
    turns: solvedReplay.turns, width: solvedReplay.width, rank: solvedReplay.rank,
    trace: solvedReplay.trace || null
  },
  seconds: +((Date.now() - t0) / 1000).toFixed(1)
};

writeFileSync(resolve('ai/mastery.json'), JSON.stringify(mastery, null, 2));
console.log(`\nВЕРДИКТ: ${mastery.verdict === 'CONFIDENT_100'
  ? `100% ПОБЕД НА ПРОХОДИМЫХ СИДАХ — ${mastery.winnableWins}/${mastery.winnableSeeds}`
  : `частично: ${mastery.winnableWins}/${mastery.winnableSeeds} проходимых`}`);
console.log(`Всего по сидам: ${mastery.totalWins}/${mastery.totalSeeds}; доказательно непроходимых: ${mastery.unwinnableSeeds.length}`);
console.log(`Время: ${mastery.seconds}с. Данные: ai/mastery.json`);
