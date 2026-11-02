/**
 * Генетический алгоритм: эволюция весов политики по приспособленности целых партий.
 *
 *   node ai/evolve.mjs [--generations 35] [--population 48] [--seeds 8]
 *                      [--max-turns 80] [--seed 20261102] [--out ai/training.json]
 *
 * Никаких учителей и готовых стратегий: старт — случайные веса, отбор — по
 * результату сыгранных партий на фиксированных сидах. Игра детерминирована,
 * поэтому приспособленность генома воспроизводима.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeRng } from './engine.mjs';
import {
  randomGenome, copyGenome, emptyGenome, genomeToJSON, FEATURES,
  fitnessForSeeds, playRun, RUN_FITNESS
} from './policy.mjs';

export const DEFAULT_CONFIG = {
  population: 48,
  generations: 60,
  // пул обучающих сидов: каждое поколение играет на новой восьмёрке,
  // чтобы веса не заучивали конкретные расклады
  seedPool: [11, 23, 37, 53, 71, 97, 113, 151, 199, 227, 251, 283,
             311, 337, 359, 383, 409, 431, 457, 479, 503, 541, 569, 593,
             617, 641, 661, 683, 709, 733, 757, 787],
  seedsPerGen: 8,
  // калибровочные сиды НЕ участвуют в отборе: по ним выбирается чемпион
  // и снимаются сравнимые метрики. Итоговая проверка — на третьей выборке.
  calibrationSeeds: Array.from({ length: 16 }, (_, i) => 2001 + i),
  maxTurns: 90,
  elite: 4,
  tournament: 3,
  crossoverRate: 0.75,
  mutationRate: 0.28,
  sigmaStart: 0.55,
  sigmaEnd: 0.07,
  immigrants: 2,
  seed: 20261102
};

const requireFitness = RUN_FITNESS;

function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function tournament(evaluated, rng, k) {
  let best = null;
  for (let i = 0; i < k; i++) {
    const c = evaluated[Math.floor(rng() * evaluated.length)];
    if (!best || c.fit > best.fit) best = c;
  }
  return best.g;
}

function crossover(a, b, rng, rate) {
  const child = emptyGenome();
  for (const key of ['w', 'perk']) {
    const A = a[key], B = b[key], C = child[key];
    for (let i = 0; i < C.length; i++) {
      if (rng() < rate) {
        // смешанное скрещивание: часть генов усредняется, часть берётся целиком
        const t = rng();
        C[i] = t < 0.35 ? (A[i] + B[i]) / 2 : (t < 0.675 ? A[i] : B[i]);
      } else C[i] = A[i];
    }
  }
  return child;
}

function mutate(g, rng, sigma, rate) {
  for (const key of ['w', 'perk']) {
    const a = g[key];
    for (let i = 0; i < a.length; i++) {
      if (rng() < rate) a[i] = Math.max(-12, Math.min(12, a[i] + gauss(rng) * sigma));
    }
  }
  return g;
}

/** Обучить политику. onGeneration(h) вызывается после каждого поколения. */
export function evolve(overrides = {}) {
  const c = { ...DEFAULT_CONFIG, ...overrides };
  if (overrides.trainSeeds) c.seedPool = overrides.trainSeeds;   // совместимость с тестами
  c.seedsPerGen = Math.min(c.seedsPerGen, c.seedPool.length);
  const cseeds = c.calibrationSeeds;
  const rotate = gen => Array.from({ length: c.seedsPerGen }, (_, i) =>
    c.seedPool[(gen * c.seedsPerGen + i) % c.seedPool.length]);
  const rng = makeRng(c.seed);
  let pop = Array.from({ length: c.population }, () => randomGenome(rng));
  let champion = null, bestFit = -Infinity, initialBest = null;
  const history = [];
  const t0 = Date.now();

  for (let gen = 0; gen < c.generations; gen++) {
    const genSeeds = rotate(gen);
    const evaluated = pop.map(g => ({ g, fit: fitnessForSeeds(g, genSeeds, c.maxTurns) }));
    evaluated.sort((a, b) => b.fit - a.fit);
    if (gen === 0) initialBest = copyGenome(evaluated[0].g);
    const mean = evaluated.reduce((n, x) => n + x.fit, 0) / evaluated.length;
    const sigma = c.sigmaStart * Math.pow(c.sigmaEnd / c.sigmaStart, gen / Math.max(1, c.generations - 1));

    // чемпион выбирается по калибровочным сидам, которых отбор не видел
    let wins = 0, floors = 0, calFit = 0;
    for (const seed of cseeds) {
      const r = playRun(seed, evaluated[0].g, { maxTurns: c.maxTurns });
      calFit += requireFitness(r);
      if (r.win) wins++;
      floors += r.floorsCleared;
    }
    calFit /= cseeds.length;
    if (calFit > bestFit) {
      bestFit = calFit;
      champion = copyGenome(evaluated[0].g);
    }
    const h = {
      gen, best: +bestFit.toFixed(2), genBest: +calFit.toFixed(2),
      mean: +mean.toFixed(2), sigma: +sigma.toFixed(3),
      trainFit: +evaluated[0].fit.toFixed(2),
      trainSeeds: genSeeds,
      wins, winRate: +(wins / cseeds.length).toFixed(3),
      avgFloors: +(floors / cseeds.length).toFixed(2)
    };
    history.push(h);
    if (c.onGeneration) c.onGeneration(h);

    const next = evaluated.slice(0, c.elite).map(x => copyGenome(x.g));
    for (let i = 0; i < c.immigrants; i++) next.push(randomGenome(rng));
    while (next.length < c.population) {
      const a = tournament(evaluated, rng, c.tournament);
      const b = tournament(evaluated, rng, c.tournament);
      next.push(mutate(crossover(a, b, rng, c.crossoverRate), rng, sigma, c.mutationRate));
    }
    pop = next;
  }

  return {
    champion, initialBest, bestFitness: +bestFit.toFixed(2), history,
    config: { ...c, onGeneration: undefined },
    seconds: +((Date.now() - t0) / 1000).toFixed(1)
  };
}

/* ------------------------------- CLI ------------------------------- */

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
const start = Date.now();
if (isCli) {
  const cfg = {
    population: +arg('population', DEFAULT_CONFIG.population),
    generations: +arg('generations', DEFAULT_CONFIG.generations),
    seeds: +arg('seeds', DEFAULT_CONFIG.seedsPerGen),
    maxTurns: +arg('max-turns', DEFAULT_CONFIG.maxTurns),
    seed: +arg('seed', DEFAULT_CONFIG.seed)
  };
  const out = arg('out', 'ai/training.json');
  const cseedsLen = DEFAULT_CONFIG.calibrationSeeds.length;
  console.log('ЭВОЛЮЦИЯ ПОЛИТИКИ «КРАЙ»');
  console.log(`популяция=${cfg.population} поколений=${cfg.generations} сидов=${cfg.seeds} ` +
              `лимит ходов=${cfg.maxTurns} ГПСЧ=${cfg.seed}`);
  console.log('пок  калибр.   обучение  σ      победы/этажи на калибровке   время');
  const result = evolve({
    ...cfg,
    seedsPerGen: cfg.seeds,
    onGeneration: h => console.log(
      String(h.gen).padStart(3),
      String(h.best).padStart(9), String(h.mean).padStart(9), String(h.sigma).padStart(6),
      `   побед ${h.wins}/${cseedsLen}  этажей ${h.avgFloors}`.padEnd(30),
      ((Date.now() - start) / 1000).toFixed(0) + 'с')
  });
  const payload = {
    config: result.config,
    history: result.history,
    bestFitness: result.bestFitness,
    seconds: result.seconds,
    champion: genomeToJSON(result.champion),
    initialBest: genomeToJSON(result.initialBest),
    features: FEATURES.map(f => ({ key: f.key, desc: f.desc }))
  };
  writeFileSync(resolve(out), JSON.stringify(payload, null, 2));
  console.log(`\nГотово за ${result.seconds}с. Лучшая приспособленность: ${result.bestFitness.toFixed(1)}`);
  console.log('Чемпион и история: ' + out);
}
