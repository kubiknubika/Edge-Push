/**
 * Тесты эволюционного ИИ. Движок не меняется: ИИ запускает тот же код из
 * index.html по маркерам. Тесты быстрые (маленькая популяция, короткие партии).
 *
 *   node --test tests/ai.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
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
