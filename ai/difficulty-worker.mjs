/** Рабочий поток для измерения сложности сидов (см. difficulty.mjs). */
import { parentPort, workerData } from 'node:worker_threads';
import { E } from './engine.mjs';
import { genomeFromJSON, playRun } from './policy.mjs';
import { solve, DEFAULT_PLAN } from './solver.mjs';

const champion = genomeFromJSON(workerData.champion);
const plan = workerData.plan || DEFAULT_PLAN;

parentPort.on('message', job => {
  const seed = job.seed;
  const before = E.guardStats.states || 0;
  E.createGame(seed);
  const guard1 = (E.guardStats.states || 0) - before;

  // 1. Реактивная политика без поиска: как далеко заходит «навык», а не перебор.
  const pure = playRun(seed, champion, { maxTurns: 90, mode: 'evolved' });

  // 2. Детерминированный решатель: сколько планирования нужно для победы.
  const r = solve(seed, champion, {
    plan, maxTurns: 90, branch: 13, exhaustive: false
  });

  parentPort.postMessage({
    index: job.index, seed,
    metrics: {
      guard1,
      policyFloors: pure.floorsCleared,
      policyKills: pure.kills,
      policyTurns: pure.turns,
      policyHp: pure.hp,
      policyWin: pure.win,
      solverWin: r.win,
      solverAttempts: r.attempts,
      solverWidth: typeof r.width === 'number' ? r.width : 0,
      solverTurns: r.turns || 0,
      solverFloors: r.maxFloors
    }
  });
});
