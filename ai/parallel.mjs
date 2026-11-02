/**
 * Простой пул из двух рабочих потоков: решаем сиды параллельно.
 * Ничего не меняет в логике поиска — только распределяет независимые сиды.
 */
import { Worker } from 'node:worker_threads';

export function parallelSolveSet(seeds, genomeJSON, opts = {}, workers = 2) {
  const jobs = seeds.map((seed, index) => ({ seed, index, wantTrace: !!opts.wantTrace }));
  const cleanOpts = { ...opts };
  delete cleanOpts.onResult;
  delete cleanOpts.wantTrace;

  return new Promise((resolve, reject) => {
    const results = new Array(seeds.length);
    const traces = {};
    let cursor = 0, done = 0;
    const pool = [];
    let failed = false;

    const dispatch = worker => {
      if (cursor < jobs.length) worker.postMessage(jobs[cursor++]);
      else worker.terminate();
    };

    for (let i = 0; i < Math.min(workers, jobs.length); i++) {
      const worker = new Worker(new URL('./solve-worker.mjs', import.meta.url), {
        workerData: { genome: genomeJSON, opts: cleanOpts }
      });
      pool.push(worker);
      worker.on('error', e => { failed = true; reject(e); });
      worker.on('message', msg => {
        results[msg.index] = msg.result;
        if (msg.trace) traces[msg.seed] = msg.trace;
        done++;
        if (opts.onResult) opts.onResult(msg.result, done, seeds.length);
        if (!failed) dispatch(worker);
        if (done === jobs.length) resolve({ rows: results, traces });
      });
      dispatch(worker);
    }
    if (!jobs.length) resolve({ rows: [], traces: {} });
  });
}
