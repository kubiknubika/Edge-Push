/** Рабочий поток для параллельного решения сидов (см. parallel.mjs). */
import { parentPort, workerData } from 'node:worker_threads';
import { genomeFromJSON } from './policy.mjs';
import { solve } from './solver.mjs';

const genome = genomeFromJSON(workerData.genome);
const opts = workerData.opts;

parentPort.on('message', job => {
  const r = solve(job.seed, genome, opts);
  parentPort.postMessage({
    index: job.index, seed: job.seed,
    result: {
      seed: job.seed, win: r.win, attempts: r.attempts,
      width: r.width || null, rank: r.rank || null,
      turns: r.turns || null, maxFloors: r.maxFloors,
      unwinnable: !!r.unwinnable, blockedAt: r.blockedAt || null,
      proofStates: r.proofStates || null, stage: !!r.stage
    },
    trace: job.wantTrace ? (r.trace || null) : null
  });
});
