/**
 * Уверенная победа: выученная функция ценности + детерминированное планирование.
 *
 * Чистая реактивная политика (argmax Q на один ход) выигрывает ~6% партий:
 * детерминированная тактическая головоломка требует смотреть вперёд. Поэтому
 * обученная оценка используется как упорядочиватель действий в поиске лучом —
 * ровно как оценочная функция в шахматном движке. Сам поиск не обучается и
 * не содержит случайности: ширина луча, варианты ранжирования и порядок попыток
 * фиксированы, результат воспроизводим.
 *
 * Бюджет эскалируется только для тех сидов, которые не решились дешевле.
 */
import { E } from './engine.mjs';
import { beamSearch } from './oracle.mjs';
import { stageSearch } from './stage.mjs';

const hp = s => (E.playerOf(s) ? E.playerOf(s).hp : 0);
const enemies = s => E.enemiesOf(s).length;

/** Варианты ранжирования состояний в луче. Все детерминированы. */
export const RANKS = {
  base: (s, q) => (s.floor - 1) * 1000 + (s.phase === 'PERKS' ? 300 : 0) +
    s.kills * 50 + hp(s) * 90 - enemies(s) * 90 - s.turn * 3 + (q || 0) * 0.1,
  noEnemy: (s, q) => (s.floor - 1) * 1000 + (s.phase === 'PERKS' ? 300 : 0) +
    s.kills * 50 + hp(s) * 90 - s.turn * 3 + (q || 0) * 0.1,
  qHeavy: (s, q) => (s.floor - 1) * 1000 + (s.phase === 'PERKS' ? 300 : 0) +
    s.kills * 50 + hp(s) * 90 - enemies(s) * 90 - s.turn * 3 + (q || 0) * 2,
  hpHeavy: (s, q) => (s.floor - 1) * 1000 + (s.phase === 'PERKS' ? 300 : 0) +
    s.kills * 50 + hp(s) * 300 - enemies(s) * 30 - s.turn * 3 + (q || 0) * 0.1,
  killsHeavy: (s, q) => (s.floor - 1) * 1000 + (s.phase === 'PERKS' ? 300 : 0) +
    s.kills * 300 + hp(s) * 90 - enemies(s) * 10 - s.turn * 2 + (q || 0) * 0.1
};

/** Порядок попыток: сначала дёшево, потом шире и с другими эвристиками. */
export const DEFAULT_PLAN = [
  { width: 96,   ranks: ['base', 'noEnemy'] },
  { width: 192,  ranks: ['base', 'noEnemy'] },
  { width: 384,  ranks: ['base', 'noEnemy', 'qHeavy', 'hpHeavy', 'killsHeavy'] },
  { width: 768,  ranks: ['base', 'noEnemy', 'qHeavy'] },
  { width: 1536, ranks: ['base', 'noEnemy'] }
];

/**
 * Решить один сид. Возвращает выигрышную траекторию или честный «не найдено».
 * Никаких случайных чисел: при том же геноме и плане результат идентичен.
 */
export function solve(seed, genome, opts = {}) {
  const plan = opts.plan || DEFAULT_PLAN;
  const maxTurns = opts.maxTurns ?? 90;
  const branch = opts.branch ?? 13;
  let attempts = 0, bestFloors = 0, bestTrace = null;
  const tried = [];

  for (const stage of plan) {
    for (const rk of stage.ranks) {
      attempts++;
      const r = beamSearch(seed, genome, {
        width: stage.width, branch, maxTurns, rank: RANKS[rk]
      });
      const floors = r.win ? 7 : r.floors;
      if (floors > bestFloors) { bestFloors = floors; bestTrace = r.trace; }
      tried.push({ width: stage.width, rank: rk, floors });
      if (r.win) {
        return {
          win: true, seed, turns: r.turns, attempts,
          width: stage.width, rank: rk, maxFloors: 7,
          trace: r.trace, tried
        };
      }
    }
  }
  // Последний уровень: посекретный поиск. Он либо находит выигрышную линию
  // там, где луч застрял, либо строго доказывает, что сид непроходим.
  if (opts.exhaustive !== false) {
    const st = stageSearch(seed, {
      cap: opts.stageCap ?? 150000,
      keep: opts.stageKeep ?? 64,
      maxTurns
    });
    if (st.win) {
      return {
        win: true, seed, turns: st.turns, attempts: attempts + 1,
        width: 'этажный поиск', rank: 'exhaustive', maxFloors: 7,
        trace: st.trace, tried, stage: true
      };
    }
    return {
      win: false, seed, attempts: attempts + 1, maxFloors: bestFloors,
      trace: bestTrace, tried, stage: true,
      unwinnable: !!st.proof, blockedAt: st.blockedAt || null,
      proofStates: st.states || null, reason: st.reason || null
    };
  }
  return {
    win: false, seed, attempts, maxFloors: bestFloors,
    trace: bestTrace, tried
  };
}

/** Решить набор сидов; onSeed — колбэк прогресса. */
export function solveSet(seeds, genome, opts = {}) {
  const rows = [];
  for (let i = 0; i < seeds.length; i++) {
    const r = solve(seeds[i], genome, opts);
    rows.push({
      seed: seeds[i], win: r.win, attempts: r.attempts,
      width: r.width || null, rank: r.rank || null,
      turns: r.turns || null, maxFloors: r.maxFloors,
      unwinnable: !!r.unwinnable, blockedAt: r.blockedAt || null,
      proofStates: r.proofStates || null, stage: !!r.stage
    });
    if (opts.onSeed) opts.onSeed(rows[rows.length - 1], i + 1, seeds.length);
  }
  return rows;
}
