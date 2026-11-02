/**
 * Честная проверка проходимости на сидах, которых эволюция не видела.
 *
 *   node ai/evaluate.mjs [--seeds 100] [--attempts 12] [--beam-width 96]
 *                        [--beam-branch 13] [--max-turns 90]
 *
 * Сравниваются: случайные ходы, лучший геном нулевого поколения, жадная
 * эвристика и чемпион. Дополнительно два поиска (не обучение!):
 *   • стохастические прогоны по softmax-оценкам обученной политики;
 *   • поиск лучом, направления которого задаёт та же обученная политика.
 * Оба ищут конкретную выигрышную последовательность ходов для каждого сида.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeRng, MAX_FLOOR } from './engine.mjs';
import {
  genomeFromJSON, heuristicGenome, playRun, RUN_FITNESS, FEATURES
} from './policy.mjs';
import { beamSearch } from './oracle.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const count = arg('seeds', 100);
const attempts = arg('attempts', 12);
const maxTurns = arg('max-turns', 90);
const beamWidth = arg('beam-width', 96);
const beamBranch = arg('beam-branch', 13);
const temperature = 0.75;
const SEEDS = Array.from({ length: count }, (_, i) => 1001 + i);

const training = JSON.parse(readFileSync(resolve('ai/training.json'), 'utf8'));
const champion = genomeFromJSON(training.champion);
const initial = genomeFromJSON(training.initialBest);

function summarize(name, rows) {
  const wins = rows.filter(r => r.win).length;
  const dist = Array.from({ length: MAX_FLOOR + 1 }, (_, i) => rows.filter(r => r.floors === i).length);
  return {
    name, seeds: rows.length, wins, winRate: +(wins / rows.length).toFixed(3),
    avgFloors: +(rows.reduce((n, r) => n + r.floors, 0) / rows.length).toFixed(2),
    avgKills: +(rows.reduce((n, r) => n + r.kills, 0) / rows.length).toFixed(2),
    avgFitness: +(rows.reduce((n, r) => n + r.fitness, 0) / rows.length).toFixed(1),
    floorDistribution: dist
  };
}

function evaluatePolicy(name, genome, mode) {
  const rows = [];
  for (const seed of SEEDS) {
    const rng = makeRng(0xA11CE ^ seed);
    const r = playRun(seed, genome, { maxTurns, mode, rng });
    rows.push({
      seed, win: r.win, floors: r.floorsCleared, kills: r.kills,
      turns: r.turns, hp: r.hp, dead: r.dead, timeout: r.timeout,
      fitness: +RUN_FITNESS(r).toFixed(1)
    });
  }
  return { summary: summarize(name, rows), rows };
}

const t0 = Date.now();
const policies = [
  evaluatePolicy('Случайные ходы', null, 'random'),
  evaluatePolicy('Поколение 0 (до обучения)', initial, 'evolved'),
  evaluatePolicy('Жадная эвристика', heuristicGenome(), 'evolved'),
  evaluatePolicy('Эволюционировавший ИИ', champion, 'evolved')
];

/* --- стохастические прогоны по обученной политике --- */
const guidedPerSeed = [];
let guidedWins = 0, guidedLine = null;
for (const seed of SEEDS) {
  let found = false, used = 0, bestFloors = 0;
  for (let k = 0; k < attempts && !found; k++) {
    used++;
    const rngSeed = (seed * 7919 + k * 104729 + 1) >>> 0;
    const r = playRun(seed, champion, {
      maxTurns, mode: 'softmax', temperature, rng: makeRng(rngSeed)
    });
    bestFloors = Math.max(bestFloors, r.floorsCleared);
    if (r.win) {
      found = true;
      guidedWins++;
      if (!guidedLine || r.turns < guidedLine.turns) {
        guidedLine = playRun(seed, champion, {
          maxTurns, mode: 'softmax', temperature, rng: makeRng(rngSeed), trace: true
        });
      }
    }
  }
  guidedPerSeed.push({ seed, found, attempts: used, bestFloors });
}

/* --- поиск лучом, направляемый обученной политикой --- */
const beamPerSeed = [];
let beamWins = 0, beamLine = null, beamFloors = 0;
for (const seed of SEEDS) {
  const r = beamSearch(seed, champion, { width: beamWidth, branch: beamBranch, maxTurns });
  const floors = r.win ? 7 : r.floors;
  beamFloors += floors;
  if (r.win) {
    beamWins++;
    if (!beamLine || r.turns < beamLine.turns) beamLine = r;
  }
  beamPerSeed.push({ seed, found: !!r.win, floors });
}

const champWins = policies[3].rows.filter(r => r.win);
const foundFlags = SEEDS.map(seed =>
  champWins.some(r => r.seed === seed) ||
  guidedPerSeed.find(x => x.seed === seed).found ||
  beamPerSeed.find(x => x.seed === seed).found);
const unionWins = foundFlags.filter(Boolean).length;
const verdict = unionWins > 0 ? 'PASSABLE' : 'NO_WIN_FOUND';

/* --- реплей: сначала победа самого чемпиона, затем поиск --- */
let replayRun = null, replaySource = '', finalState = null, replayTrace = null;
if (champWins.length) {
  const seed = champWins.slice().sort((a, b) => a.turns - b.turns)[0].seed;
  replayRun = playRun(seed, champion, { maxTurns, trace: true });
  replayTrace = replayRun.trace;
  finalState = replayRun.finalState;
  replaySource = 'детерминированный чемпион';
} else if (guidedLine) {
  replayRun = guidedLine;
  replayTrace = guidedLine.trace;
  finalState = guidedLine.finalState;
  replaySource = 'стохастический поиск по обученной политике';
} else if (beamLine) {
  const tail = beamLine.trace[beamLine.trace.length - 1].state;
  replayRun = {
    seed: beamLine.seed, turns: beamLine.turns, floorsCleared: 7,
    kills: tail.kills, hp: tail.hp
  };
  replayTrace = beamLine.trace;          // уже заканчивается кадром WIN
  replaySource = 'поиск лучом по обученной политике';
}

const results = {
  generatedAt: new Date().toISOString(),
  config: {
    heldOutSeeds: [SEEDS[0], SEEDS[SEEDS.length - 1]], seedCount: count,
    maxTurns, guidedAttempts: attempts, softmaxTemperature: temperature,
    beamWidth, beamBranch
  },
  training: {
    generations: training.history.length,
    population: training.config.population,
    seedPoolSize: (training.config.seedPool || training.config.trainSeeds || []).length,
    seedsPerGen: training.config.seedsPerGen || (training.config.trainSeeds || []).length,
    calibrationSeeds: (training.config.calibrationSeeds || []).length,
    bestFitness: training.bestFitness,
    seconds: training.seconds,
    initialFitness: training.history[0].best,
    finalWinRate: training.history[training.history.length - 1].winRate
  },
  policies: policies.map(p => p.summary),
  perPolicyRows: Object.fromEntries(policies.map(p => [p.summary.name, p.rows])),
  guidedSearch: {
    attemptsPerSeed: attempts,
    guidedWins,
    championWins: champWins.length,
    beamWins,
    beamWidth, beamBranch,
    beamAvgFloors: +(beamFloors / count).toFixed(2),
    unionWins,
    winRate: +(unionWins / count).toFixed(3),
    guidedRate: +(guidedWins / count).toFixed(3),
    beamRate: +(beamWins / count).toFixed(3),
    perSeed: SEEDS.map((seed, i) => ({
      seed, guided: guidedPerSeed[i].found, beam: beamPerSeed[i].found,
      found: foundFlags[i], beamFloors: beamPerSeed[i].floors
    }))
  },
  verdict,
  replaySource,
  featureCount: FEATURES.length,
  genomeSize: FEATURES.length + 6
};

writeFileSync(resolve('ai/results.json'), JSON.stringify(results, null, 2));
if (replayRun) {
  writeFileSync(resolve('ai/replay.json'), JSON.stringify({
    seed: replayRun.seed, source: replaySource, turns: replayRun.turns,
    floors: replayRun.floorsCleared, kills: replayRun.kills, hp: replayRun.hp,
    trace: replayTrace, final: finalState
  }, null, 2));
}

console.log('ПРОВЕРКА ПРОХОДИМОСТИ (сиды ' + SEEDS[0] + '…' + SEEDS[SEEDS.length - 1] + ', ' + count + ' шт.)');
console.log('политика                              побед   ср.этажей  ср.убийств  ср.фитнес');
for (const p of results.policies)
  console.log(p.name.padEnd(36), String(p.wins + '/' + p.seeds).padStart(6),
    String(p.avgFloors).padStart(11), String(p.avgKills).padStart(12), String(p.avgFitness).padStart(11));
console.log(`\nСтохастический поиск: ${guidedWins}/${count} сидов`);
console.log(`Поиск лучом (W=${beamWidth}): ${beamWins}/${count} сидов, ср. ${results.guidedSearch.beamAvgFloors}/7 этажей`);
console.log(`Объединённо найдена выигрышная траектория: ${unionWins}/${count} сидов`);
console.log('ВЕРДИКТ: ' + (verdict === 'PASSABLE' ? 'ИГРА ПРОХОДИМА' : 'выигрышная траектория не найдена'));
console.log('Реплей: ' + (replayRun ? `сид ${replayRun.seed}, ${replayRun.turns} ходов, ${replayRun.floorsCleared}/7 этажей (${replaySource})` : 'нет'));
console.log('Время проверки: ' + ((Date.now() - t0) / 1000).toFixed(1) + 'с');
