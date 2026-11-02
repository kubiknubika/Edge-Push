/**
 * Посекретный исчерпывающий поиск (fallback для самых упрямых сидов).
 *
 * Идея: вместо одного огромного дерева на 7 этажей раскрываем граф состояний
 * ПОЭТАЖНО. На этаже делаем BFS с дедупликацией по полному состоянию (счётчик
 * ходов в логике не участвует — его исключаем из ключа, граф конечен). Все
 * состояния «ЭТАЖ ЗАЧИЩЕН» переносим на следующий этаж, выбирая перки.
 *
 * Экономия памяти: в истории хранятся только пары (родитель, действие), а
 * ключи посещённых состояний — хэши. Кадры реплея восстанавливаются в конце
 * детерминированным проигрыванием найденной цепочки действий.
 *
 * Возвращает либо полную выигрышную траекторию, либо строгое доказательство,
 * что на некотором этаже не существует ни одного продолжения.
 */
import { E, legalActions, applyAction, compact } from './engine.mjs';

/** Ключ состояния без счётчика ходов (он используется только в HUD). */
export function floorKey(s) {
  return JSON.stringify([
    s.floor, s.rng, s.phase, s.grid,
    s.entities.filter(e => e.alive).map(e => [e.id, e.x, e.y, e.hp, e.type, e.kind]),
    E.playerOf(s) ? E.playerOf(s).hp : 0, E.playerOf(s) ? E.playerOf(s).maxHp : 3,
    s.shield, s.hookCd, s.throwCd, s.mode, s.perks, s.perkChoices,
    s.activeIds, s.intents.map(i => [i.id, i.kind, i.cells])
  ]);
}

/** Два независимых 32-битных хэша вместо длинной строки в Set. */
function hashKey(str) {
  let h1 = 2166136261, h2 = 5381;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = (Math.imul(h2, 33) ^ c) | 0;
  }
  return (h1 >>> 0).toString(36) + ':' + (h2 >>> 0).toString(36);
}

const perkScore = s => (E.playerOf(s) ? E.playerOf(s).hp : 0) * 100 +
  s.kills * 30 + s.perks.length * 5 - s.turn * 2;

function buildTrace(seed, nodes, lastIndex) {
  const chain = [];
  for (let i = lastIndex; i >= 0; i = nodes[i].parent) chain.push(nodes[i]);
  chain.reverse();
  let s = E.createGame(seed);
  const trace = [];
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i].action;
    trace.push({ state: compact(s), action: a });
    s = applyAction(s, a).state;
  }
  trace.push({ state: compact(s), action: { type: 'WIN' } });
  return trace;
}

/**
 * @param {number} seed
 * @param {object} opts { cap, keep, maxTurns }
 *   cap  — максимум состояний на этаж (защита от взрыва),
 *   keep — сколько лучших «этаж зачищен» состояний переносить дальше (0 = все).
 */
export function stageSearch(seed, opts = {}) {
  const cap = opts.cap ?? 150000;
  const keep = opts.keep ?? 0;
  const maxTurns = opts.maxTurns ?? 90;
  const start = E.createGame(seed);
  const nodes = [{ parent: -1, action: null }];
  let frontier = [{ idx: 0, s: start }];
  const perFloor = [];

  for (let floor = 1; floor <= E.MAX_FLOOR; floor++) {
    const seen = new Set(frontier.map(f => hashKey(floorKey(f.s))));
    let level = frontier;
    const perks = [];
    let steps = 0, limit = false;

    while (level.length && steps < maxTurns && seen.size < cap) {
      const next = [];
      for (const item of level) {
        const s = item.s;
        for (const a of legalActions(s)) {
          const ns = applyAction(s, a).state;
          if (ns.phase === 'WIN') {
            nodes.push({ parent: item.idx, action: a });
            const trace = buildTrace(seed, nodes, nodes.length - 1);
            return {
              win: true, seed, turns: trace.length - 1, states: seen.size,
              trace, perFloor
            };
          }
          const k = hashKey(floorKey(ns));
          if (ns.phase === 'PERKS') {
            if (!seen.has(k)) {
              seen.add(k);
              nodes.push({ parent: item.idx, action: a });
              perks.push({ idx: nodes.length - 1, s: ns });
            }
            continue;
          }
          if (ns.phase === 'DEAD') continue;
          if (seen.has(k)) continue;
          seen.add(k);
          nodes.push({ parent: item.idx, action: a });
          next.push({ idx: nodes.length - 1, s: ns });
        }
      }
      level = next;
      steps++;
      if (seen.size >= cap) limit = true;
    }

    const exhausted = !level.length && !limit;
    perFloor.push({ floor, states: seen.size, perkStates: perks.length, exhausted, limit });
    if (!perks.length) {
      // Доказательство только при ПОЛНОМ исчерпании графа этажа.
      return {
        win: false, seed, blockedAt: floor, states: seen.size, perFloor,
        proof: exhausted, reason: exhausted ? 'exhausted' : 'budget'
      };
    }

    if (keep > 0 && perks.length > keep) {
      perks.sort((a, b) => perkScore(b.s) - perkScore(a.s));
      perks.length = keep;
    }
    const nextFrontier = [];
    const used = new Set();
    for (const p of perks) {
      for (const id of p.s.perkChoices) {
        const ns = E.choosePerk(p.s, id);
        const k = hashKey(floorKey(ns));
        if (used.has(k)) continue;
        used.add(k);
        nodes.push({ parent: p.idx, action: { type: 'PERK', id } });
        nextFrontier.push({ idx: nodes.length - 1, s: ns });
      }
    }
    frontier = nextFrontier;
    if (!frontier.length) {
      return {
        win: false, seed, blockedAt: floor, states: seen.size, perFloor,
        proof: exhausted, reason: exhausted ? 'exhausted' : 'budget'
      };
    }
  }
  return { win: false, seed, finished: true, perFloor };
}

/** Строгая классификация сида: проходим / непроходим (с номером этажа). */
export function classifySeed(seed, opts = {}) {
  return stageSearch(seed, { keep: 0, ...opts });
}
