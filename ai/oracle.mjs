/**
 * Поиск лучом (beam search) — верхняя оценка проходимости сида.
 *
 * Это НЕ обучаемая политика и не замена эволюции: поиск лишь отвечает на вопрос
 * «существует ли вообще выигрышная последовательность ходов?». Направляет его
 * обученная функция ценности (порядок действий), а отсечение идёт по прогрессу
 * партии. Полного перебора дерева нет: ширина луча и глубина ограничены.
 */
import { E, stateKey, compact, applyAction } from './engine.mjs';
import { scoreActions } from './policy.mjs';

function rank(s, q) {
  const p = E.playerOf(s), enemies = E.enemiesOf(s);
  return (s.floor - 1) * 1000 + (s.phase === 'PERKS' ? 300 : 0) +
    s.kills * 50 + (p ? p.hp : 0) * 90 - enemies.length * 90 -
    s.turn * 3 + (q || 0) * 0.1;
}

/** Восстановить кадры реплея, проиграв цепочку действий с нуля. */
function replayTrace(seed, steps) {
  let s = E.createGame(seed);
  const trace = [];
  for (const st of steps) {
    trace.push({ state: compact(s), action: st.a, score: st.q });
    s = applyAction(s, st.a).state;
  }
  return trace;
}

export function beamSearch(seed, genome, opts = {}) {
  const maxTurns = opts.maxTurns ?? 90;
  const width = opts.width ?? 12;
  const branch = opts.branch ?? 8;
  const rankFn = opts.rank || rank;
  const start = E.createGame(seed);
  // В узлах луча храним только цепочку действий, а не компактные состояния:
  // это позволяет поднимать ширину до тысяч без взрыва памяти.
  let beam = [{ s: start, steps: [], score: 0 }];
  const seen = new Set([stateKey(start)]);
  let bestFloors = 0, bestSteps = null;

  for (let depth = 0; depth < maxTurns && beam.length; depth++) {
    const next = [];
    const localSeen = new Set();
    for (const node of beam) {
      const s = node.s;
      let expansions;
      if (s.phase === 'PERKS') {
        expansions = s.perkChoices.map(id => ({
          action: { type: 'PERK', id }, after: E.choosePerk(s, id), q: 0
        }));
      } else if (s.phase === 'PLAYER') {
        const scored = scoreActions(s, genome);
        const picked = scored.slice(0, branch);
        if (scored.length > branch + 2) {
          picked.push(scored[Math.floor(scored.length / 2)], scored[scored.length - 1]);
        }
        expansions = picked.map(x => ({ action: x.action, after: x.after, q: x.score }));
      } else continue;

      for (const e of expansions) {
        const ns = e.after;
        const steps = node.steps.concat([{ a: e.action, q: e.q }]);
        if (ns.phase === 'WIN') {
          const trace = replayTrace(seed, steps).concat([
            { state: compact(ns), action: { type: 'WIN' } }
          ]);
          return {
            win: true, seed, turns: steps.length, floors: 7, trace
          };
        }
        if (ns.phase === 'DEAD') continue;
        if (ns.phase === 'PERKS' || ns.phase === 'PLAYER') {
          const f = ns.floor - 1;
          if (f > bestFloors) { bestFloors = f; bestSteps = steps; }
        }
        const key = stateKey(ns);
        if (seen.has(key) || localSeen.has(key)) continue;
        localSeen.add(key);
        next.push({ s: ns, steps, score: rankFn(ns, e.q) });
      }
    }
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, width);
    for (const node of beam) seen.add(stateKey(node.s));
    if (beam.length < width && next.length > beam.length) beam = next.slice(0, width);
  }
  return {
    win: false, seed, floors: bestFloors,
    trace: bestSteps ? replayTrace(seed, bestSteps) : null
  };
}


/* ---------------------------------------------------------------------------
 * Жадный best-first с дедупликацией: для сидов, где луч упирается в плато.
 * Отличается от beam тем, что НЕ отсекает состояния по «худости» прогресса:
 * раскрывает лучшее по эвристике состояние из всей очереди, пока не найдёт WIN
 * или не исчерпает бюджет. Использует ту же выученную оценку действий.
 * ------------------------------------------------------------------------- */
class MinMaxHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a; a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].score >= a[i].score) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].score > a[m].score) m = l;
        if (r < a.length && a[r].score > a[m].score) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

export function bestFirstSearch(seed, genome, opts = {}) {
  const cap = opts.cap ?? 200000;
  const maxTurns = opts.maxTurns ?? 90;
  const rankFn = opts.rank || rank;
  const start = E.createGame(seed);
  const heap = new MinMaxHeap();
  heap.push({ s: start, trace: [], score: rankFn(start, 0), depth: 0 });
  const seen = new Set([stateKey(start)]);
  let bestFloors = 0, bestTrace = null;

  while (heap.size && seen.size < cap) {
    const node = heap.pop();
    const scored = scoreActions(node.s, genome);
    for (const x of scored) {
      const ns = x.after;
      const trace = node.trace.concat([{ state: compact(node.s), action: x.action, score: x.score }]);
      if (ns.phase === 'WIN') {
        return {
          win: true, seed, turns: trace.length, states: seen.size,
          trace: trace.concat([{ state: compact(ns), action: { type: 'WIN' } }])
        };
      }
      if (ns.phase === 'DEAD' || node.depth + 1 > maxTurns) continue;
      const k = stateKey(ns);
      if (seen.has(k)) continue;
      seen.add(k);
      const f = ns.floor - 1;
      if (f > bestFloors) { bestFloors = f; bestTrace = trace; }
      heap.push({
        s: ns, trace, depth: node.depth + 1,
        score: rankFn(ns, x.score) - node.depth * 0.01
      });
    }
  }
  return { win: false, seed, floors: bestFloors, states: seen.size, trace: bestTrace };
}
