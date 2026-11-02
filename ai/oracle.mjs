/**
 * Поиск лучом (beam search) — верхняя оценка проходимости сида.
 *
 * Это НЕ обучаемая политика и не замена эволюции: поиск лишь отвечает на вопрос
 * «существует ли вообще выигрышная последовательность ходов?». Направляет его
 * обученная функция ценности (порядок действий), а отсечение идёт по прогрессу
 * партии. Полного перебора дерева нет: ширина луча и глубина ограничены.
 */
import { E, stateKey, compact } from './engine.mjs';
import { scoreActions } from './policy.mjs';

function rank(s, q) {
  const p = E.playerOf(s), enemies = E.enemiesOf(s);
  return (s.floor - 1) * 1000 + (s.phase === 'PERKS' ? 300 : 0) +
    s.kills * 50 + (p ? p.hp : 0) * 90 - enemies.length * 90 -
    s.turn * 3 + (q || 0) * 0.1;
}

export function beamSearch(seed, genome, opts = {}) {
  const maxTurns = opts.maxTurns ?? 90;
  const width = opts.width ?? 12;
  const branch = opts.branch ?? 8;
  const start = E.createGame(seed);
  let beam = [{ s: start, trace: [], score: 0 }];
  const seen = new Set([stateKey(start)]);
  let bestFloors = 0, bestTrace = null;

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
        // берём вершину рейтинга политики + несколько «неочевидных» действий
        const picked = scored.slice(0, branch);
        if (scored.length > branch + 2) {
          picked.push(scored[Math.floor(scored.length / 2)], scored[scored.length - 1]);
        }
        expansions = picked.map(x => ({ action: x.action, after: x.after, q: x.score }));
      } else continue;

      for (const e of expansions) {
        const ns = e.after;
        const trace = node.trace.concat([{ state: compact(s), action: e.action, score: e.q }]);
        if (ns.phase === 'WIN') {
          return {
            win: true, seed, turns: trace.length, floors: 7,
            trace: trace.concat([{ state: compact(ns), action: { type: 'WIN' } }])
          };
        }
        if (ns.phase === 'DEAD') continue;
        if (ns.phase === 'PERKS' || ns.phase === 'PLAYER') {
          const f = ns.floor - 1;
          if (f > bestFloors) { bestFloors = f; bestTrace = trace; }
        }
        const key = stateKey(ns);
        if (seen.has(key) || localSeen.has(key)) continue;
        localSeen.add(key);
        next.push({ s: ns, trace, score: rank(ns, e.q) });
      }
    }
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, width);
    for (const n of beam) seen.add(stateKey(n.s));
    // не даём лучу застрять: если все лучшие с одного этажа, оставляем и «отстающих»
    if (beam.length < width && next.length > beam.length) beam = next.slice(0, width);
  }
  return { win: false, seed, floors: bestFloors, trace: bestTrace };
}
