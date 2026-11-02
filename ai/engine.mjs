/**
 * Загрузка детерминированного движка прямо из single-file index.html.
 * Берётся только код между маркерами ENGINE START/END — без DOM и без UI.
 * Никаких копий правил: ИИ играет тем же автоматом, что и игрок в браузере.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const match = html.match(/\/\* ===== ENGINE START ===== \*\/([\s\S]*?)\/\* ===== ENGINE END ===== \*\//);
if (!match) throw new Error('Маркеры ENGINE START/END не найдены в index.html');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(match[1], sandbox);

export const E = sandbox.EdgeEngine;
export const PERK_IDS = E.PERKS.map(p => p.id);
export const MAX_FLOOR = E.MAX_FLOOR;

/** setMode — переключатель, а не присваивание: приводим состояние к нужному режиму. */
export function withMode(s, mode) {
  let t = s;
  if (t.mode !== 'BASIC') t = E.setMode(t, t.mode);   // HOOK/THROW → BASIC
  if (mode !== 'BASIC') t = E.setMode(t, mode);       // BASIC → HOOK/THROW
  return t;
}

export function availableModes(s) {
  const modes = ['BASIC'];
  if (s.hookCd === 0) modes.push('HOOK');
  if (s.throwCd === 0) modes.push('THROW');
  return modes;
}

/**
 * Полный перебор легальных действий в текущем состоянии.
 * Действия — это (режим, направление), «ждать» и выбор перка.
 * Нелегальные шаги отсекаются через E.preview, то есть ИИ не может «сходить»
 * туда, куда не может игрок.
 */
export function legalActions(s) {
  if (s.phase === 'PERKS') return s.perkChoices.map(id => ({ type: 'PERK', id }));
  if (s.phase !== 'PLAYER') return [];
  const out = [];
  for (const mode of availableModes(s)) {
    const ms = withMode(s, mode);
    const pv = E.preview(ms);
    for (const d of E.DIRS) {
      const info = pv.dirs[d.key];
      if (!info || !info.valid) continue;
      out.push({ type: 'DIR', dir: d.key, mode, kind: info.kind, label: info.label });
    }
  }
  out.push({ type: 'WAIT', mode: 'BASIC', kind: 'WAIT', label: '+1 ЩИТ' });
  return out;
}

/** Применить действие. Для удобства поиска возвращает и само действие. */
export function applyAction(s, a) {
  if (a.type === 'PERK') return { state: E.choosePerk(s, a.id), spent: true, action: a };
  const ms = withMode(s, a.mode || 'BASIC');
  const r = E.performTurn(ms, { type: a.type, dir: a.dir });
  return { state: r.state, spent: r.spent, action: a };
}

/** Компактное представление состояния для реплея в отчёте. */
export function compact(s) {
  const p = E.playerOf(s);
  return {
    floor: s.floor, turn: s.turn, phase: s.phase, mode: s.mode,
    hp: p ? p.hp : 0, maxHp: p ? p.maxHp : 3, shield: s.shield,
    kills: s.kills, falls: s.falls, hookCd: s.hookCd, throwCd: s.throwCd,
    activeIds: s.activeIds.slice(),
    grid: s.grid.map(row => row.slice()),
    entities: s.entities.filter(e => e.alive).map(e => ({
      kind: e.kind, type: e.type || '', x: e.x, y: e.y, hp: e.hp, id: e.id
    }))
  };
}

/** Отпечаток состояния для дедупликации в поиске. */
export function stateKey(s) {
  return JSON.stringify([
    s.floor, s.turn, s.rng, s.phase, s.mode, s.shield, s.hookCd, s.throwCd,
    s.kills, s.perks, s.grid,
    s.entities.filter(e => e.alive).map(e => [e.id, e.x, e.y, e.hp, e.type, e.kind])
  ]);
}

/** Воспроизводимый ГПСЧ для самого генетического алгоритма (не для игры!). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
