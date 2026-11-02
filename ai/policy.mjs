/**
 * Эволюционируемая политика ИИ.
 *
 * Геном — это вектор весов линейной функции ценности действия Q(s,a) = w · φ(s,a),
 * плюс 6 весов для выбора перков. φ считается после честной симуляции одного
 * полного хода движком (включая фазу врагов), поэтому ИИ видит реальные последствия,
 * а не догадки. Веса не обучаются градиентом: их подбирает генетический алгоритм
 * по приспособленности целых партий (см. evolve.mjs). Никакого A*, MCTS и
 * перебора дерева в самой политике нет.
 */
import { E, PERK_IDS, MAX_FLOOR, legalActions, applyAction, compact } from './engine.mjs';

/* --------------------------- признаки --------------------------- */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const HAZARD_TILE = t => t === 'CHASM' || t === 'LAVA' || t === 'SPIKES' || t === 'PILLAR';
const neighbors = (x, y) => [
  { x, y: y - 1 }, { x: x + 1, y }, { x, y: y + 1 }, { x: x - 1, y }
];

/** Куда примерно улетит враг при базовом толчке (для признака «сулит сброс»). */
function pushProspect(before, action) {
  if (action.type !== 'DIR' || action.mode !== 'BASIC' || action.kind !== 'PUSH') return { fall: 0, harm: 0 };
  const d = E.DIR[action.dir], p = E.playerOf(before);
  if (!d || !p) return { fall: 0, harm: 0 };
  const len = 2 + E.perkLevel(before, 'HEAVY_RAM');
  const x = p.x + d.dx * (1 + len), y = p.y + d.dy * (1 + len);
  const t = E.tileAt(before, x, y);
  if (t === 'VOID' || t === 'CHASM') return { fall: 1, harm: 0 };
  if (HAZARD_TILE(t)) return { fall: 0, harm: 1 };
  const u = E.unitAt(before, x, y);
  if (u && u.type === 'BARREL') return { fall: 0, harm: 1 };
  return { fall: 0, harm: 0 };
}

/**
 * Признаковый контекст: состояние до хода, само действие и состояние после
 * полного хода (уже с фазой врагов и перезарядками).
 */
function makeContext(before, action, after) {
  const pb = E.playerOf(before), pa = E.playerOf(after);
  const enemies = E.enemiesOf(after);
  const hpBefore = pb ? pb.hp : 0, hpAfter = pa ? pa.hp : 0;
  const px = pa ? pa.x : 2, py = pa ? pa.y : 2;
  const minDist = enemies.length
    ? Math.min(...enemies.map(e => Math.abs(e.x - px) + Math.abs(e.y - py))) : 4;
  const enemyAtEdge = enemies.filter(e =>
    neighbors(e.x, e.y).some(c => {
      const t = E.tileAt(after, c.x, c.y);
      return t === 'VOID' || t === 'CHASM';
    })).length;
  const playerNearHazard = neighbors(px, py).filter(c => HAZARD_TILE(E.tileAt(after, c.x, c.y))).length;
  const underAttack = after.intents.filter(it =>
    it.kind !== 'WAIT' && it.cells && it.cells.some(c => c.x === px && c.y === py)).length;
  const prospect = pushProspect(before, action);
  return {
    before, action, after, hpBefore, hpAfter, enemies, px, py,
    minDist, enemyAtEdge, playerNearHazard, underAttack, prospect
  };
}

/** Каждый признак: ключ, русское пояснение и функция от контекста. */
export const FEATURES = [
  { key: 'bias',            desc: 'свободный член',                 f: () => 1 },
  { key: 'win',             desc: 'победа в партии',                f: c => c.after.phase === 'WIN' ? 1 : 0 },
  { key: 'floorCleared',    desc: 'этаж зачищен',                   f: c => (c.after.phase === 'PERKS' || c.after.phase === 'WIN') ? 1 : 0 },
  { key: 'dead',            desc: 'гибель героя',                   f: c => c.after.phase === 'DEAD' ? 1 : 0 },
  { key: 'kills',           desc: 'убито врагов за ход',            f: c => clamp(c.after.kills - c.before.kills, 0, 4) / 2 },
  { key: 'falls',           desc: 'сброшено в бездну за ход',       f: c => clamp(c.after.falls - c.before.falls, 0, 4) / 2 },
  { key: 'hpLost',          desc: 'потеряно HP за ход',             f: c => clamp(c.hpBefore - c.hpAfter, 0, 3) / 3 },
  { key: 'hpAfter',         desc: 'оставшееся HP',                  f: c => clamp(c.hpAfter, 0, 4) / 3 },
  { key: 'enemyLeft',       desc: 'живых врагов на этаже',          f: c => c.enemies.length / 5 },
  { key: 'enemyHp',         desc: 'суммарное HP врагов',            f: c => c.enemies.reduce((n, e) => n + e.hp, 0) / 10 },
  { key: 'threats',         desc: 'активных угроз',                 f: c => c.after.activeIds.length / 2 },
  { key: 'underAttack',     desc: 'прицелы по клетке героя',        f: c => c.underAttack / 2 },
  { key: 'minEnemyDist',    desc: 'дистанция до ближайшего врага',  f: c => c.minDist / 5 },
  { key: 'enemyAtEdge',     desc: 'врагов у края/пропасти',         f: c => c.enemyAtEdge / 5 },
  { key: 'playerAtEdge',    desc: 'герой на краю',                  f: c => (c.px === 0 || c.px === 4 || c.py === 0 || c.py === 4) ? 1 : 0 },
  { key: 'playerCentrality',desc: 'герой ближе к центру',           f: c => 1 - (Math.abs(c.px - 2) + Math.abs(c.py - 2)) / 4 },
  { key: 'playerNearHazard',desc: 'герой рядом с опасной клеткой',  f: c => c.playerNearHazard / 4 },
  { key: 'hookReady',       desc: 'крюк готов',                     f: c => c.after.hookCd === 0 ? 1 : 0 },
  { key: 'throwReady',      desc: 'бросок готов',                   f: c => c.after.throwCd === 0 ? 1 : 0 },
  { key: 'actWait',         desc: 'действие: ждать',                f: c => c.action.type === 'WAIT' ? 1 : 0 },
  { key: 'actHook',         desc: 'действие: крюк',                 f: c => c.action.mode === 'HOOK' ? 1 : 0 },
  { key: 'actThrow',        desc: 'действие: бросок',               f: c => c.action.mode === 'THROW' ? 1 : 0 },
  { key: 'actPush',         desc: 'действие: толчок',               f: c => c.action.kind === 'PUSH' ? 1 : 0 },
  { key: 'actPull',         desc: 'действие: притягивание',         f: c => c.action.kind === 'PULL' ? 1 : 0 },
  { key: 'actFallProspect', desc: 'действие сулит сброс в бездну',  f: c => (c.action.kind === 'FALL' || c.action.kind === 'VOID' || c.prospect.fall ||
                                                                        (c.action.mode === 'HOOK' && c.action.label === '!')) ? 1 : 0 },
  { key: 'actHarmProspect', desc: 'действие сулит урон/оглушение',  f: c => (c.action.kind === 'HAZARD' || c.action.kind === 'SWAP' || c.prospect.harm) ? 1 : 0 },
  { key: 'turnCost',        desc: 'затягивание партии',             f: c => c.after.turn / 100 },
  { key: 'floorProgress',   desc: 'глубина забега',                 f: c => (c.after.floor - 1) / MAX_FLOOR }
];

export const NFEAT = FEATURES.length;
export const GENOME_SIZE = NFEAT + PERK_IDS.length;

/* --------------------------- геном --------------------------- */

export function emptyGenome() {
  return { w: new Float64Array(NFEAT), perk: new Float64Array(PERK_IDS.length) };
}

export function randomGenome(rng, scale = 0.6) {
  const g = emptyGenome();
  for (let i = 0; i < NFEAT; i++) g.w[i] = (rng() * 2 - 1) * scale;
  for (let i = 0; i < PERK_IDS.length; i++) g.perk[i] = (rng() * 2 - 1) * scale;
  return g;
}

export function copyGenome(g) {
  return { w: Float64Array.from(g.w), perk: Float64Array.from(g.perk) };
}

export function genomeToJSON(g) {
  return { w: Array.from(g.w, v => +v.toFixed(6)), perk: Array.from(g.perk, v => +v.toFixed(6)) };
}

export function genomeFromJSON(o) {
  const g = emptyGenome();
  for (let i = 0; i < NFEAT; i++) g.w[i] = o.w[i] || 0;
  for (let i = 0; i < PERK_IDS.length; i++) g.perk[i] = o.perk[i] || 0;
  return g;
}

/** Эталонная «жадная эвристика» — не обучалась, нужна только для сравнения. */
export function heuristicGenome() {
  const g = emptyGenome();
  const set = (k, v) => { g.w[FEATURES.findIndex(f => f.key === k)] = v; };
  set('win', 12); set('floorCleared', 8); set('dead', -14);
  set('kills', 9); set('falls', 3); set('hpLost', -6); set('hpAfter', 2);
  set('enemyLeft', -3); set('enemyHp', -1); set('underAttack', -3);
  set('actWait', -4); set('actFallProspect', 4); set('actHarmProspect', 2);
  set('actPush', 1); set('turnCost', -1);
  for (let i = 0; i < PERK_IDS.length; i++) g.perk[i] = [3, 1, 4, 1, 5, 6][i] || 0;
  return g;
}

/* --------------------------- принятие решений --------------------------- */

export function actionVector(ctx) {
  const v = new Float64Array(NFEAT);
  for (let i = 0; i < NFEAT; i++) v[i] = FEATURES[i].f(ctx);
  return v;
}

function dot(w, v) {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * v[i];
  return s;
}

/** Все легальные действия с их оценкой и честно просимулированным результатом. */
export function scoreActions(s, genome) {
  const out = [];
  for (const a of legalActions(s)) {
    const r = applyAction(s, a);
    const ctx = makeContext(s, a, r.state);
    const v = actionVector(ctx);
    out.push({ action: a, after: r.state, spent: r.spent, score: dot(genome.w, v), features: v });
  }
  // устойчивый порядок при равных оценках
  out.sort((x, y) => (y.score - x.score) || x.action.type.localeCompare(y.action.type));
  return out;
}

export function choosePerk(s, genome) {
  let best = s.perkChoices[0], bestScore = -Infinity;
  for (const id of s.perkChoices) {
    const score = genome.perk[PERK_IDS.indexOf(id)] ?? 0;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

/** Мягкий выбор действия для стохастического поиска вокруг обученной политики. */
export function softmaxPick(scored, rng, temperature = 0.7) {
  const max = scored[0].score;
  const weights = scored.map(x => Math.exp((x.score - max) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i];
    if (r <= 0) return scored[i];
  }
  return scored[scored.length - 1];
}

/* --------------------------- прогон партии --------------------------- */

export const RUN_FITNESS = r =>
  r.floorsCleared * 1200 + (r.win ? 6000 : 0) + r.kills * 45 + r.falls * 30 +
  r.hp * 25 - r.turns * 4 - (r.dead ? 120 : 0);

/**
 * Сыграть одну партию от сида до победы/смерти/лимита ходов.
 * mode: 'evolved' (argmax), 'random', 'softmax'. trace=true пишет реплей.
 */
export function playRun(seed, genome, opts = {}) {
  const maxTurns = opts.maxTurns ?? 90;
  const rng = opts.rng || Math.random;
  const mode = opts.mode || 'evolved';
  const g = genome || emptyGenome();   // случайной политике веса не нужны
  let s = E.createGame(seed);
  let turns = 0;
  const trace = opts.trace ? [] : null;

  while (s.phase !== 'WIN' && s.phase !== 'DEAD' && turns < maxTurns) {
    if (s.phase === 'PERKS') {
      const id = mode === 'random'
        ? s.perkChoices[Math.floor(rng() * s.perkChoices.length)]
        : choosePerk(s, g);
      if (trace) trace.push({ state: compact(s), action: { type: 'PERK', id }, label: 'ПЕРК: ' + id });
      s = E.choosePerk(s, id);
      continue;
    }
    const scored = scoreActions(s, g);
    if (!scored.length) break;
    let chosen;
    if (mode === 'random') chosen = scored[Math.floor(rng() * scored.length)];
    else if (mode === 'softmax') chosen = softmaxPick(scored, rng, opts.temperature ?? 0.7);
    else chosen = scored[0];
    if (trace) trace.push({ state: compact(s), action: chosen.action, score: +chosen.score.toFixed(3) });
    if (!chosen.spent) break;               // защита: нелегальный ход не должен встретиться
    s = chosen.after;
    turns++;
  }

  const p = E.playerOf(s);
  const run = {
    seed, win: s.phase === 'WIN', dead: s.phase === 'DEAD',
    timeout: turns >= maxTurns && s.phase !== 'WIN' && s.phase !== 'DEAD',
    floors: s.floor,
    floorsCleared: s.phase === 'WIN' ? MAX_FLOOR : s.floor - 1,
    kills: s.kills, falls: s.falls, hp: p ? p.hp : 0, turns,
    finalState: compact(s)
  };
  if (trace) run.trace = trace;
  return run;
}

export function fitnessForSeeds(genome, seeds, maxTurns) {
  let sum = 0;
  for (const seed of seeds) sum += RUN_FITNESS(playRun(seed, genome, { maxTurns }));
  return sum / seeds.length;
}
