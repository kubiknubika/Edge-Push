/**
 * Тесты эволюционного ИИ. Движок не меняется: ИИ запускает тот же код из
 * index.html по маркерам. Тесты быстрые (маленькая популяция, короткие партии).
 *
 *   node --test tests/ai.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  E, PERK_IDS, MAX_FLOOR, legalActions, applyAction, compact,
  stateKey, makeRng
} from '../ai/engine.mjs';
import {
  FEATURES, NFEAT, GENOME_SIZE, emptyGenome, randomGenome, genomeToJSON,
  genomeFromJSON, heuristicGenome, scoreActions, choosePerk, playRun,
  RUN_FITNESS, fitnessForSeeds
} from '../ai/policy.mjs';
import { evolve } from '../ai/evolve.mjs';

const rng = makeRng(12345);

test('ИИ: движок загружен из index.html и экспортирует тот же автомат', () => {
  assert.equal(typeof E.createGame, 'function');
  assert.equal(typeof E.performTurn, 'function');
  assert.equal(E.SIZE, 5);
  assert.equal(MAX_FLOOR, 7);
  assert.equal(PERK_IDS.length, 6);
  const s = E.createGame(2026);
  assert.equal(s.phase, 'PLAYER');
  assert.equal(s.floor, 1);
  assert.equal(s.grid.length, 5);
});

test('ИИ: перебирает только легальные действия, каждое тратит ход', () => {
  for (const seed of [1, 7, 2026, 99991]) {
    const s = E.createGame(seed);
    const acts = legalActions(s);
    assert.ok(acts.length > 0);
    assert.equal(acts.filter(a => a.type === 'WAIT').length, 1);
    for (const a of acts) {
      const r = applyAction(s, a);
      assert.equal(r.spent, true, `действие ${JSON.stringify(a)} должно тратить ход`);
      // при гибели движок не увеличивает счётчик ходов — это его честное поведение
      if (r.state.phase === 'DEAD') assert.equal(r.state.turn, s.turn);
      else assert.equal(r.state.turn, s.turn + 1);
      assert.notEqual(r.state, s, 'состояние клонируется');
    }
    // в WIN/DEAD действий нет
    const dead = E.clone(s); dead.phase = 'DEAD';
    assert.deepEqual(legalActions(dead), []);
  }
});

test('ИИ: размер генома совпадает с числом признаков, веса туда-обратно', () => {
  assert.equal(NFEAT, FEATURES.length);
  assert.equal(GENOME_SIZE, NFEAT + PERK_IDS.length);
  const g = randomGenome(rng);
  const back = genomeFromJSON(genomeToJSON(g));
  assert.equal(back.w.length, NFEAT);
  for (let i = 0; i < NFEAT; i++) assert.ok(Math.abs(back.w[i] - g.w[i]) < 1e-5);
  assert.equal(emptyGenome().w.every(v => v === 0), true);
});

test('ИИ: оценка действия считает все признаки на реальном результате хода', () => {
  const s = E.createGame(42), g = heuristicGenome();
  const scored = scoreActions(s, g);
  assert.ok(scored.length > 0);
  for (const x of scored) {
    assert.equal(x.features.length, NFEAT);
    assert.ok(Number.isFinite(x.score));
    assert.ok(x.spent);
    assert.ok(x.after.grid.length === 5);
  }
  // отсортировано по убыванию оценки
  for (let i = 1; i < scored.length; i++) assert.ok(scored[i - 1].score >= scored[i].score);
});

test('ИИ: выбирает перк только из предложенных', () => {
  const s = E.createGame(3);
  s.phase = 'PERKS';
  s.perkChoices = ['HEAVY_RAM', 'LUCKY_HARPOON', 'SECOND_BREATH'];
  for (let i = 0; i < 20; i++) {
    const id = choosePerk(s, randomGenome(rng));
    assert.ok(s.perkChoices.includes(id));
  }
  const r = applyAction(s, { type: 'PERK', id: 'SECOND_BREATH' });
  assert.equal(r.state.floor, 2);
  assert.equal(r.state.phase, 'PLAYER');
});

test('ИИ: партия детерминирована и всегда завершается в пределах лимита', () => {
  const g = heuristicGenome();
  const a = playRun(2026, g, { maxTurns: 40 });
  const b = playRun(2026, g, { maxTurns: 40 });
  assert.deepEqual(a, b);
  assert.ok(a.turns <= 40);
  assert.ok(a.win || a.dead || a.timeout);
  assert.equal(typeof RUN_FITNESS(a), 'number');
  assert.equal(typeof fitnessForSeeds(g, [1, 2], 20), 'number');
  assert.equal(compact(a.finalState).grid.length, 5);
  assert.equal(stateKey(E.createGame(7)), stateKey(E.createGame(7)));
});

test('ИИ: реплей содержит состояние до каждого хода и выбранное действие', () => {
  const r = playRun(11, heuristicGenome(), { maxTurns: 30, trace: true });
  assert.ok(r.trace.length > 0);
  assert.equal(r.trace.length, r.turns + r.trace.filter(t => t.action.type === 'PERK').length);
  for (const f of r.trace) {
    assert.equal(f.state.grid.length, 5);
    assert.ok(f.action && f.action.type);
    assert.ok(Array.isArray(f.state.entities));
  }
});

test('ИИ: генетический алгоритм не ухудшает лучшего (элитизм) и улучшает популяцию', () => {
  const r = evolve({ population: 8, generations: 5, trainSeeds: [11, 23, 37], maxTurns: 25, seed: 777 });
  assert.equal(r.history.length, 5);
  assert.ok(r.champion && r.initialBest);
  for (let i = 1; i < r.history.length; i++)
    assert.ok(r.history[i].best >= r.history[i - 1].best, 'лучший фитнес не убывает');
  assert.ok(r.bestFitness >= r.history[0].best);
  assert.ok(r.history[r.history.length - 1].mean > r.history[0].mean, 'среднее выросло');
  assert.ok(Number.isFinite(r.seconds));
});

test('ИИ: случайная политика не использует веса и воспроизводима', () => {
  const a = playRun(5, null, { mode: 'random', maxTurns: 20, rng: makeRng(9) });
  const b = playRun(5, null, { mode: 'random', maxTurns: 20, rng: makeRng(9) });
  assert.deepEqual(a, b);
});

/* -------------------- уверенная победа (solver) -------------------- */
import { RANKS, DEFAULT_PLAN, solve, solveSet } from '../ai/solver.mjs';
import { parallelSolveSet } from '../ai/parallel.mjs';

const championJSON = JSON.parse(readFileSync(new URL('../ai/training.json', import.meta.url), 'utf8')).champion;
const solverGenome = genomeFromJSON(championJSON);

test('ИИ: все варианты ранжирования конечны и детерминированы', () => {
  const s = E.createGame(1023);
  for (const [name, fn] of Object.entries(RANKS)) {
    const a = fn(s, 1.25), b = fn(s, 1.25);
    assert.ok(Number.isFinite(a), name);
    assert.equal(a, b, name);
  }
  assert.ok(DEFAULT_PLAN.length >= 3);
  assert.ok(DEFAULT_PLAN.every(x => x.width > 0 && x.ranks.length > 0));
});

test('ИИ: решатель выигрывает известный сид и воспроизводим', () => {
  const plan = [{ width: 96, ranks: ['base'] }];
  const a = solve(1023, solverGenome, { plan, maxTurns: 90, branch: 13 });
  const b = solve(1023, solverGenome, { plan, maxTurns: 90, branch: 13 });
  assert.equal(a.win, true);
  assert.deepEqual(
    { win: a.win, turns: a.turns, width: a.width, rank: a.rank, attempts: a.attempts },
    { win: b.win, turns: b.turns, width: b.width, rank: b.rank, attempts: b.attempts });
  assert.ok(a.trace.length > 0);
  assert.equal(a.trace[a.trace.length - 1].action.type, 'WIN');
});

test('ИИ: solveSet и параллельный пул дают одинаковые результаты', async () => {
  const seeds = [1023, 1040];
  const plan = [{ width: 96, ranks: ['base', 'noEnemy'] }];
  const serial = solveSet(seeds, solverGenome, { plan, maxTurns: 90, branch: 13 });
  const { rows: parallel } = await parallelSolveSet(seeds, championJSON,
    { plan, maxTurns: 90, branch: 13, workers: 2 });
  assert.equal(serial.length, parallel.length);
  for (let i = 0; i < seeds.length; i++) {
    assert.equal(parallel[i].seed, serial[i].seed);
    assert.equal(parallel[i].win, serial[i].win);
    assert.equal(parallel[i].attempts, serial[i].attempts);
    assert.equal(parallel[i].width, serial[i].width);
  }
});

/* -------------------- 10 уровней сложности -------------------- */
test('ИИ: 10 пулов сидов раздельны, упорядочены по сложности и проверены на проходимость', () => {
  const d = JSON.parse(readFileSync(new URL('../ai/difficulty.json', import.meta.url), 'utf8'));
  assert.equal(d.levels.length, 10);
  assert.equal(d.config.levels, 10);
  assert.ok(d.config.candidates >= d.config.perLevel * 10);
  const all = [];
  for (let i = 0; i < 10; i++) {
    const l = d.levels[i];
    assert.equal(l.level, i + 1);
    assert.ok(l.name.length > 0);
    assert.ok(l.hint.length > 0);
    assert.equal(l.seeds.length, d.config.perLevel);
    assert.ok(l.seeds.every(s => Number.isInteger(s) && s >= d.config.candidateSeeds[0] &&
      s <= d.config.candidateSeeds[1]), 'сиды уровня ' + l.level + ' из диапазона кандидатов');
    all.push(...l.seeds);
    if (i > 0) assert.ok(l.medianScore >= d.levels[i - 1].medianScore,
      'медианный балл уровня ' + l.level + ' не ниже предыдущего');
  }
  assert.equal(new Set(all).size, all.length, 'пулы не пересекаются');
  const perSeed = new Map(d.perSeed.map(r => [r.seed, r]));
  for (const seed of all) {
    const r = perSeed.get(seed);
    assert.ok(r, 'есть замер для сида ' + seed);
    assert.ok(r.solverWidth > 0, 'решатель подтвердил победу на сиде ' + seed);
  }
});

test('ИИ: все сиды 10 пулов дают проходимый первый этаж', () => {
  const d = JSON.parse(readFileSync(new URL('../ai/difficulty.json', import.meta.url), 'utf8'));
  for (const l of d.levels) {
    for (const seed of l.seeds) {
      const s = E.createGame(seed);
      assert.equal(s.phase, 'PLAYER', 'сид ' + seed + ' стартует корректно');
      assert.equal(E.floorIsPassable(s), true, 'первый этаж проходим, сид ' + seed);
    }
  }
});
