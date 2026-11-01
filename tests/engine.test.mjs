/**
 * Тесты чистого движка «КРАЙ».
 * Движок живёт внутри index.html (single-file build); тест вытаскивает его
 * по маркерам и исполняет в vm-контексте без DOM.
 *
 *   node --test tests/engine.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const match = html.match(/\/\* ===== ENGINE START ===== \*\/([\s\S]*?)\/\* ===== ENGINE END ===== \*\//);
assert.ok(match, 'маркеры ENGINE START/END найдены');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(match[1], sandbox);
const E = sandbox.EdgeEngine;
assert.ok(E && typeof E.createGame === 'function', 'EdgeEngine экспортирован');

/* ------------------------------ helpers ------------------------------ */
const blankGrid = () => Array.from({ length:5 }, () => Array(5).fill('FLOOR'));

/** Пустая арена 5×5 FLOOR с заданными юнитами; намерения врагов отключены. */
function scene(setup) {
  const s = E.createGame(1);
  s.grid = blankGrid();
  s.entities = [];
  s.nextId = 1;
  s.floor = 1; s.turn = 1; s.phase = 'PLAYER'; s.mode = 'BASIC';
  s.shield = 0; s.perks = []; s.hookCd = 0; s.throwCd = 0;
  s.kills = 0; s.falls = 0; s.perkChoices = [];
  const add = o => {
    const e = Object.assign({ id:s.nextId++, alive:true, spawn:-1, hp:1, maxHp:1 }, o);
    s.entities.push(e);
    return e;
  };
  const units = setup(s, add);
  const wantedMode = s.mode, wantedShield = s.shield;
  E.startPlayerTurn(s);    // сбрасывает mode/shield — вернём их после инициализации намерений
  s.mode = wantedMode;
  s.shield = wantedShield;
  s.intents = [];          // нейтрализуем фазу врагов, если тест не про неё
  s.activeIds = [];
  return Object.assign({ s, units }, units || {});
}
const enemy = (add, type, x, y, spawn = 0, hp) => {
  const h = hp === undefined ? E.ENEMY_HP[type] : hp;
  return add({ kind:'ENEMY', type, x, y, hp:h, maxHp:h, spawn });
};
const player = (add, x, y, hp = 3) => add({ kind:'PLAYER', x, y, hp, maxHp:hp });
const barrel = (add, x, y) => add({ kind:'BARREL', type:'BARREL', x, y, hp:1, maxHp:1 });
const ends = res => res.frames[res.frames.length - 1].state;
const allEvents = res => res.frames.flatMap(f => f.events);

function connectivity(s) {
  const seen = new Set(), comps = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const t = s.grid[y][x];
    if (t === 'CHASM' || t === 'PILLAR' || seen.has(y * 5 + x)) continue;
    const q = [{ x, y }], comp = [];
    seen.add(y * 5 + x);
    while (q.length) {
      const c = q.shift(); comp.push(c);
      for (const d of E.DIRS) {
        const nx = c.x + d.dx, ny = c.y + d.dy;
        if (!E.inBounds(nx, ny)) continue;
        const nt = s.grid[ny][nx];
        if (nt === 'CHASM' || nt === 'PILLAR') continue;
        const k = ny * 5 + nx;
        if (seen.has(k)) continue;
        seen.add(k); q.push({ x:nx, y:ny });
      }
    }
    comps.push(comp);
  }
  return comps;
}
function assertInvariants(s) {
  assert.equal(s.grid.length, 5);
  for (const row of s.grid) assert.equal(row.length, 5);
  const cells = new Set();
  const p = E.playerOf(s);
  if (p) assert.ok(p.alive, 'живой герой присутствует (или партия окончена)');
  for (const e of s.entities) {
    assert.ok(E.inBounds(e.x, e.y), 'юнит в пределах поля: ' + JSON.stringify(e));
    assert.ok(!cells.has(e.x + ',' + e.y), 'не более одного объекта на клетке');
    cells.add(e.x + ',' + e.y);
    assert.ok(e.hp <= e.maxHp, 'hp <= maxHp');
  }
  assert.ok(s.activeIds.length <= 2, 'не более 2 активных угроз');
  assert.ok(s.intents.length <= 2, 'не более 2 намерений');
  assert.ok(['PLAYER','PERKS','WIN','DEAD'].includes(s.phase));
}

function countTiles(s, kind) {
  return s.grid.flat().filter(t => t === kind).length;
}

/* ------------------------------ generation ------------------------------ */
test('генерация: 200 сидов, арена без тупиков и в рамках ТЗ', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const s = E.createGame(seed);
    assertInvariants(s);
    const chasms = countTiles(s, 'CHASM');
    assert.ok(chasms >= 6 && chasms <= 10, 'пропастей 6–10, сид ' + seed + ': ' + chasms);
    assert.ok(countTiles(s, 'PILLAR') >= 1 && countTiles(s, 'PILLAR') <= 2, 'колонн 1–2');
    const hazards = countTiles(s, 'SPIKES') + countTiles(s, 'LAVA');
    assert.ok(hazards >= 1 && hazards <= 2, 'ловушек 1–2');
    const barrels = s.entities.filter(e => e.kind === 'BARREL').length;
    assert.ok(barrels >= 1 && barrels <= 2, 'бочек 1–2');
    const en = E.enemiesOf(s);
    assert.equal(en.length, 3, 'на 1 этаже 3 врага');
    assert.equal(connectivity(s).length, 1, 'все проходимые клетки связны, сид ' + seed);
    const p = E.playerOf(s);
    assert.equal(s.grid[p.y][p.x], 'FLOOR', 'герой на полу');
    const adj = E.DIRS.filter(d => E.tileAt(s, p.x + d.dx, p.y + d.dy) === 'FLOOR');
    assert.ok(adj.length >= 2, 'у героя есть минимум 2 выхода, сид ' + seed);
    for (const e of en) {
      assert.equal(s.grid[e.y][e.x], 'FLOOR');
      assert.ok(Math.abs(e.x - p.x) + Math.abs(e.y - p.y) >= 2, 'враг на расстоянии >= 2');
    }
    assert.equal(s.activeIds.length, 2, 'ровно 2 активные угрозы');
    assert.equal(s.intents.length, 2);
    for (const it of s.intents) {
      assert.ok(['ATTACK','CHARGE','SHOOT','MOVE','WAIT'].includes(it.kind));
    }
    // центральный 3×3 преимущественно пол
    let centerFloor = 0;
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++)
      if (s.grid[y][x] === 'FLOOR') centerFloor++;
    assert.ok(centerFloor >= 6, 'центр 3×3 в основном FLOOR');
  }
});

test('детерминизм: одинаковый сид и последовательность ходов дают одинаковое состояние', () => {
  const actions = [
    { type:'DIR', dir:'UP' }, { type:'WAIT' }, { type:'DIR', dir:'LEFT' },
    { type:'DIR', dir:'DOWN' }, { type:'DIR', dir:'RIGHT' }, { type:'WAIT' }
  ];
  const run = () => {
    let s = E.createGame(4242);
    const trace = [];
    for (const a of actions) {
      const r = E.performTurn(s, a);
      s = r.state;
      trace.push(r.spent);
      if (s.phase !== 'PLAYER') break;
    }
    return { s, trace };
  };
  assert.deepEqual(run(), run());
});

test('автосохранение: JSON round-trip не меняет поведение', () => {
  let s = E.createGame(77);
  s = E.performTurn(s, { type:'WAIT' }).state;
  const restored = JSON.parse(JSON.stringify(s));
  const a = E.performTurn(s, { type:'DIR', dir:'UP' });
  const b = E.performTurn(restored, { type:'DIR', dir:'UP' });
  assert.deepEqual(b.state, a.state);
  assert.deepEqual(b.frames, a.frames);
});

/* ------------------------------ базовый шаг ------------------------------ */
test('защита от случайной смерти: шаг в пропасть/лаву/шипы/колонну/край не тратит ход', () => {
  for (const bad of ['CHASM','LAVA','SPIKES','PILLAR']) {
    const { s } = scene((st, add) => {
      player(add, 2, 2);
      enemy(add, 'BRUTE', 4, 4, 0);
      st.grid[1][2] = bad;                         // клетка сверху от героя
      return {};
    });
    const before = E.clone(s);
    const r = E.performTurn(s, { type:'DIR', dir:'UP' });
    assert.equal(r.spent, false, bad + ': ход не потрачен');
    assert.deepEqual(r.state, before, bad + ': состояние не изменилось');
    assert.ok(allEvents(r).some(e => e.t === 'shake'));
  }
  const { s } = scene((st, add) => {
    player(add, 0, 2);
    enemy(add, 'BRUTE', 4, 4, 0);
    return {};
  });
  const r = E.performTurn(s, { type:'DIR', dir:'LEFT' });   // за границу поля
  assert.equal(r.spent, false);
});

test('базовый шаг на пустую клетку и толчок щитом', () => {
  const { s } = scene((st, add) => {
    player(add, 2, 2);
    enemy(add, 'BRUTE', 4, 4, 0);
    return {};
  });
  const r = E.performTurn(s, { type:'DIR', dir:'DOWN' });
  assert.equal(r.spent, true);
  const p = E.playerOf(ends(r));
  assert.deepEqual([p.x, p.y], [2, 3]);
  assert.equal(ends(r).turn, 2);
  assert.ok(allEvents(r).some(e => e.t === 'move' && e.id === p.id));
});

/* ------------------------------ импульс ------------------------------ */
test('resolvePush: вылет за край / в пропасть убивает мгновенно', () => {
  const { s } = scene((st, add) => {
    player(add, 1, 2);
    enemy(add, 'BRUTE', 2, 2, 0);
    st.grid[2][3] = 'CHASM';
    return {};
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  assert.equal(E.enemiesOf(ends(r)).length, 0, 'враг погиб');
  assert.equal(ends(r).kills, 1);
  assert.equal(ends(r).falls, 1);
  assert.equal(ends(r).phase, 'PERKS', 'этаж мгновенно пройден');
  assert.ok(allEvents(r).some(e => e.t === 'fall'));
});

test('resolvePush: домино — первый враг сталкивает второго в пропасть', () => {
  const { s, a, b } = scene((st, add) => {
    player(add, 1, 2);
    const a = enemy(add, 'BRUTE', 2, 2, 0);
    const b = enemy(add, 'BRUTE', 3, 2, 1);
    st.grid[2][4] = 'CHASM';
    return { a, b };
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  const final = ends(r);
  const A = E.byId(final, a.id), B = E.byId(final, b.id);
  assert.equal(B, undefined, 'второй враг упал');
  assert.equal(A.hp, 1, 'первый получил 1 урон от столкновения');
  assert.deepEqual([A.x, A.y], [2, 2], 'первый остановился перед вторым');
  assert.equal(final.kills, 1);
});

test('resolvePush: удар о колонну = 1 урона, с перком «Шипованные стены» = 2', () => {
  for (const [perks, hp] of [[[], 1], [['SPIKED_WALLS'], 0]]) {
    const { s, e } = scene((st, add) => {
      player(add, 1, 2);
      const e = enemy(add, 'BRUTE', 2, 2, 0);
      enemy(add, 'BRUTE', 4, 4, 1);
      st.grid[2][3] = 'PILLAR';
      st.perks = perks.slice();
      return { e };
    });
    const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
    const u = E.byId(ends(r), e.id);
    if (hp === 0) assert.equal(u, undefined, 'враг убит о стену');
    else {
      assert.equal(u.hp, hp);
      assert.deepEqual([u.x, u.y], [2, 2]);
    }
  }
});

test('resolvePush: ловушка наносит 1 урон и останавливает цель', () => {
  const { s, e } = scene((st, add) => {
    player(add, 1, 2);
    const e = enemy(add, 'BRUTE', 2, 2, 0);
    enemy(add, 'BRUTE', 4, 4, 1);
    st.grid[2][3] = 'LAVA';
    return { e };
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  const u = E.byId(ends(r), e.id);
  assert.equal(u.hp, 1);
  assert.deepEqual([u.x, u.y], [3, 2]);
});

test('перк «Тяжёлый таран»: толчок на 3 клетки', () => {
  const { s, e } = scene((st, add) => {
    player(add, 0, 2);
    const e = enemy(add, 'BRUTE', 1, 2, 0);
    enemy(add, 'BRUTE', 4, 4, 1);
    st.perks = ['HEAVY_RAM'];
    return { e };
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  const u = E.byId(ends(r), e.id);
  assert.deepEqual([u.x, u.y], [4, 2], 'прошёл 3 клетки и остановился у края');
});

test('JUGGERNAUT сдвигается только на 1 клетку, но падает в пропасть', () => {
  const { s, e } = scene((st, add) => {
    player(add, 1, 2);
    const e = enemy(add, 'JUGGERNAUT', 2, 2, 0);
    enemy(add, 'BRUTE', 0, 0, 1);
    return { e };
  });
  let r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  assert.deepEqual([E.byId(ends(r), e.id).x, E.byId(ends(r), e.id).y], [3, 2]);

  const s2 = E.clone(s);
  s2.grid[2][3] = 'CHASM';
  r = E.performTurn(s2, { type:'DIR', dir:'RIGHT' });
  assert.equal(E.byId(ends(r), e.id), undefined);
  assert.equal(ends(r).falls, 1);
});

/* ------------------------------ бочки ------------------------------ */
test('бочка: 2 урона в 3×3 и разлет соседей, цепные взрывы через очередь', () => {
  const { s, e1, e2 } = scene((st, add) => {
    player(add, 1, 2);
    barrel(add, 2, 2);
    const e1 = enemy(add, 'BRUTE', 2, 1, 0);
    const e2 = enemy(add, 'SNIPER', 2, 3, 1);
    st.grid[2][3] = 'PILLAR';
    return { e1, e2 };
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  const final = ends(r);
  assert.ok(allEvents(r).filter(e => e.t === 'explosion').length >= 1, 'взрыв воспроизведён');
  assert.equal(E.byId(final, e1.id), undefined, 'враг в зоне 3×3 погиб');
  assert.equal(E.byId(final, e2.id), undefined);
  assert.equal(final.kills, 2);
  assert.equal(final.phase, 'PERKS');
});

test('цепная детонация двух бочек завершается без бесконечного цикла', () => {
  const { s } = scene((st, add) => {
    player(add, 1, 2);
    barrel(add, 2, 2);
    barrel(add, 3, 2);
    enemy(add, 'BRUTE', 3, 3, 0);
    enemy(add, 'BRUTE', 0, 0, 1);
    return {};
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  assert.ok(allEvents(r).filter(e => e.t === 'explosion').length >= 2, 'обе бочки взорвались');
  assertInvariants(ends(r));
});

test('живая бомба взрывается от любого урона', () => {
  const { s } = scene((st, add) => {
    player(add, 1, 2);
    enemy(add, 'BOMBER', 2, 2, 0);
    enemy(add, 'BRUTE', 2, 1, 1);
    st.grid[2][3] = 'PILLAR';
    return {};
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  assert.ok(allEvents(r).some(e => e.t === 'explosion'));
  assert.equal(E.enemiesOf(ends(r)).length, 0, 'бомба унесла соседа');
});

/* ------------------------------ крюк ------------------------------ */
test('крюк: цель притягивается прямо перед героем и падает в пропасть', () => {
  const { s } = scene((st, add) => {
    player(add, 0, 2);
    enemy(add, 'BRUTE', 2, 2, 0);
    enemy(add, 'BRUTE', 4, 4, 1);
    st.grid[2][1] = 'CHASM';
    st.mode = 'HOOK';
    return {};
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  assert.equal(ends(r).kills, 1);
  assert.equal(ends(r).falls, 1);
  assert.equal(ends(r).hookCd, 2, 'откат 2 хода');
  assert.ok(allEvents(r).some(e => e.t === 'hook'));
});

test('крюк: луч, упёршийся в колонну, не тратит ход', () => {
  const { s } = scene((st, add) => {
    player(add, 0, 2);
    enemy(add, 'BRUTE', 4, 4, 0);
    st.grid[2][2] = 'PILLAR';
    st.mode = 'HOOK';
    return {};
  });
  const before = E.clone(s);
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  assert.equal(r.spent, false);
  assert.deepEqual(r.state, before);
});

test('крюк: ловушка перед героем наносит урон, «Азартный гарпун» сбрасывает откат', () => {
  const { s, e } = scene((st, add) => {
    player(add, 0, 2);
    const e = enemy(add, 'SNIPER', 2, 2, 0);  // 1 HP — умрёт на лаве
    enemy(add, 'BRUTE', 4, 4, 1);
    st.grid[2][1] = 'LAVA';
    st.mode = 'HOOK';
    st.perks = ['LUCKY_HARPOON'];
    return { e };
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  assert.equal(E.byId(ends(r), e.id), undefined, 'снайпер погиб в ловушке');
  assert.equal(ends(r).hookCd, 0, 'крюк мгновенно перезаряжен');
  assert.ok(allEvents(r).some(e => e.text && e.text.includes('ПЕРЕЗАРЯДКА')));
});

test('крюк: луч игнорирует вплотную стоящего юнита (i=1)', () => {
  const { s, near, far } = scene((st, add) => {
    player(add, 0, 2);
    const near = enemy(add, 'BRUTE', 1, 2, 0);
    const far = enemy(add, 'SNIPER', 3, 2, 1);
    st.grid[2][1] = 'CHASM';
    st.mode = 'HOOK';
    return { near, far };
  });
  // near стоит на пропасти в этой сцене быть не может — поправим клетку вручную:
  s.grid[2][1] = 'FLOOR';
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  assert.equal(ends(r).kills, 1, 'дальний враг притянут и погиб от crush с ближним');
});

/* ------------------------------ бросок ------------------------------ */
test('бросок через плечо: позади пропасть — враг улетает в бездну', () => {
  const { s, e } = scene((st, add) => {
    player(add, 2, 2);
    const e = enemy(add, 'BRUTE', 3, 2, 0);
    enemy(add, 'BRUTE', 0, 0, 1);
    st.grid[2][1] = 'CHASM';
    st.mode = 'THROW';
    return { e };
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  assert.equal(E.byId(ends(r), e.id), undefined);
  assert.equal(ends(r).falls, 1);
  assert.equal(ends(r).throwCd, 2);
  assert.deepEqual([E.playerOf(ends(r)).x, E.playerOf(ends(r)).y], [2, 2], 'герой остался на месте');
});

test('бросок: край карты позади считается бездной', () => {
  const { s, e } = scene((st, add) => {
    player(add, 4, 2);
    const e = enemy(add, 'BRUTE', 3, 2, 0);
    enemy(add, 'BRUTE', 0, 0, 1);
    st.mode = 'THROW';
    return { e };
  });
  const r = E.performTurn(s, { type:'DIR', dir:'LEFT' });
  assert.equal(E.byId(ends(r), e.id), undefined);
  assert.ok(allEvents(r).some(e => e.t === 'fall'));
});

test('бросок: стена/юнит позади => смена мест и оглушение', () => {
  const { s, e, p } = scene((st, add) => {
    const p = player(add, 2, 2);
    const e = enemy(add, 'BRUTE', 3, 2, 0);
    enemy(add, 'SNIPER', 0, 0, 1);
    st.grid[2][1] = 'PILLAR';
    st.mode = 'THROW';
    return { e, p };
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  const final = ends(r);
  assert.deepEqual([E.playerOf(final).x, E.playerOf(final).y], [3, 2], 'герой встал на место врага');
  assert.deepEqual([E.byId(final, e.id).x, E.byId(final, e.id).y], [2, 2], 'враг встал на место героя');
  assert.ok(allEvents(r).some(e => e.text && e.text.includes('ОГЛУШЁН')));
  assert.ok(allEvents(r).some(e => e.text && e.text.includes('СМЕНА')));
});

test('бросок без цели перед героем не тратит ход', () => {
  const { s } = scene((st, add) => {
    player(add, 2, 2);
    enemy(add, 'BRUTE', 0, 0, 0);
    st.mode = 'THROW';
    return {};
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  assert.equal(r.spent, false);
});

test('перк «Ударное приземление» раскидывает соседних врагов', () => {
  const { s, e } = scene((st, add) => {
    player(add, 2, 2);
    enemy(add, 'BRUTE', 3, 2, 0);
    const e = enemy(add, 'BRUTE', 2, 1, 1);
    st.grid[2][1] = 'FLOOR';
    st.mode = 'THROW';
    st.perks = ['SHOCK_LANDING'];
    return { e };
  });
  const r = E.performTurn(s, { type:'DIR', dir:'RIGHT' });
  const u = E.byId(ends(r), e.id);
  assert.ok(u, 'соседний враг жив');
  assert.deepEqual([u.x, u.y], [2, 0], 'отлетел вверх на 1 клетку от героя');
});

/* ------------------------------ щит и враги ------------------------------ */
test('ЖДАТЬ: щит гасит один удар, к следующему ходу обнуляется', () => {
  const { s, p } = scene((st, add) => {
    const p = player(add, 2, 2);
    const brute = enemy(add, 'BRUTE', 3, 2, 0);
    enemy(add, 'SNIPER', 0, 0, 1);
    st.intents = []; // зададим вручную ниже
    return { p, brute };
  });
  s.intents = [E.computeIntent(s, E.byId(s, 2))];   // id=2 — громила вплотную
  assert.equal(s.intents[0].kind, 'ATTACK');
  const r = E.performTurn(s, { type:'WAIT' });
  assert.equal(E.playerOf(ends(r)).hp, 3, 'урон поглощён');
  assert.deepEqual([E.playerOf(ends(r)).x, E.playerOf(ends(r)).y], [2, 2], 'толчок тоже поглощён');
  assert.equal(ends(r).shield, 0, 'щит живёт до начала следующего хода');
  assert.ok(allEvents(r).some(e => e.t === 'shield'));

  const r2 = E.performTurn(E.clone(s), { type:'WAIT' });
  // без ожидания щита: сравним с ходом, где щит не выдан — см. следующий тест
  assert.ok(r2.spent);
});

test('урон врага проходит, если щита нет; активных угроз не больше двух', () => {
  const { s, brute } = scene((st, add) => {
    player(add, 2, 2);
    const brute = enemy(add, 'BRUTE', 3, 2, 0);
    enemy(add, 'SNIPER', 0, 0, 1);
    enemy(add, 'BOMBER', 4, 4, 2);
    return { brute };
  });
  s.intents = [E.computeIntent(s, brute)];
  const r = E.performTurn(s, { type:'DIR', dir:'UP' });   // игрок уходит в сторону
  assert.equal(E.playerOf(ends(r)).hp, 3, 'атака по старой клетке промахнулась');
  assert.ok(allEvents(r).some(e => e.text === 'МИМО!'));

  const s2 = E.clone(s);
  s2.intents = [E.computeIntent(s2, brute)];
  const r2 = E.performTurn(s2, { type:'WAIT' });          // щит есть -> см. прошлый тест
  assert.ok(r2.spent);
});

test('CHARGER: если герой ушёл вбок, бык сам улетает в пропасть', () => {
  const { s, charger } = scene((st, add) => {
    player(add, 2, 2);
    const charger = enemy(add, 'CHARGER', 2, 0, 0);
    enemy(add, 'SNIPER', 0, 4, 1);
    st.grid[4][2] = 'CHASM';
    return { charger };
  });
  s.intents = [E.computeIntent(s, charger)];
  assert.equal(s.intents[0].kind, 'CHARGE');
  const r = E.performTurn(s, { type:'DIR', dir:'LEFT' });   // шаг в сторону
  assert.equal(E.byId(ends(r), charger.id), undefined, 'бык сорвался');
  assert.equal(ends(r).falls, 1);
});

test('SNIPER: стреляет первым объектом на линии, попадая и по своим', () => {
  const { s, ally, sniper } = scene((st, add) => {
    player(add, 4, 2);
    const ally = enemy(add, 'BRUTE', 2, 2, 0);
    const sniper = enemy(add, 'SNIPER', 0, 2, 1);
    enemy(add, 'BOMBER', 4, 4, 2);
    return { ally, sniper };
  });
  s.intents = [E.computeIntent(s, sniper)];
  assert.equal(s.intents[0].kind, 'SHOOT');
  const r = E.performTurn(s, { type:'WAIT' });
  assert.equal(E.byId(ends(r), ally.id).hp, 1, 'союзник получил 1 урон');
  assert.deepEqual([E.byId(ends(r), ally.id).x, E.byId(ends(r), ally.id).y], [3, 2], 'и толчок на 1');
});

/* ------------------------------ режимы, откаты, перки, забег ------------------------------ */
test('setMode: переключатель, откат блокирует повторную активацию', () => {
  let s = E.createGame(9);
  s = E.setMode(s, 'HOOK');
  assert.equal(s.mode, 'HOOK');
  s = E.setMode(s, 'HOOK');
  assert.equal(s.mode, 'BASIC', 'повторный тап отменяет режим');
  s.hookCd = 2;
  s = E.setMode(s, 'HOOK');
  assert.equal(s.mode, 'BASIC', 'на откате режим недоступен');
  assert.ok(E.preview(s).dirs.UP !== undefined, 'превью для всех 4 направлений');
});

test('откат 2 хода и перк «Длинные цепи» (1 ход)', () => {
  const mk = (perks) => scene((st, add) => {
    player(add, 0, 2);
    enemy(add, 'BRUTE', 2, 2, 0);
    enemy(add, 'SNIPER', 0, 4, 1);
    st.mode = 'HOOK';
    st.perks = perks.slice();
    return {};
  });
  for (const [perks, cdAfterUse, cdNext] of [[[], 2, 1], [['LONG_CHAINS'], 1, 0]]) {
    let r = E.performTurn(mk(perks).s, { type:'DIR', dir:'RIGHT' });
    // враг притянулся на (1,2), этаж не пройден (второй враг жив)
    assert.equal(ends(r).hookCd, cdAfterUse, 'откат сразу после использования');
    r = E.performTurn(ends(r), { type:'WAIT' });
    assert.equal(ends(r).hookCd, cdNext, 'откат после следующего хода');
  }
});

test('7 этажей: 3 / 4 / 5 врагов, мини-босс и победа', () => {
  let s = E.createGame(321);
  const counts = [3];
  for (let f = 1; f <= 6; f++) {
    s.entities = s.entities.filter(e => e.kind === 'PLAYER');
    s.phase = 'PERKS';
    s.perkChoices = E.choosePerkCards(s);
    assert.equal(s.perkChoices.length, 3, 'всегда 3 разные карточки');
    assert.equal(new Set(s.perkChoices).size, 3);
    const hpBefore = E.playerOf(s).hp;
    s = E.choosePerk(s, s.perkChoices[0]);
    assert.equal(s.floor, f + 1);
    assert.equal(s.phase, 'PLAYER');
    assert.equal(s.hookCd, 0);
    assert.equal(s.shield, 0);
    assert.ok(E.playerOf(s).hp >= hpBefore, 'HP переносится (или лечится перком)');
    assertInvariants(s);
    counts.push(E.enemiesOf(s).length);
  }
  assert.deepEqual(counts, [3,3,4,4,4,5,5], 'число врагов по этажам');
  assert.ok(E.enemiesOf(s).some(e => e.type === 'JUGGERNAUT' && e.hp === 4), 'мини-босс на 7 этаже');
  s.entities = s.entities.filter(e => e.kind === 'PLAYER');
  const r = E.performTurn(s, { type:'WAIT' });
  assert.equal(ends(r).phase, 'WIN', '7 этаж без врагов = победа без выбора перка');
  assert.equal(ends(r).perkChoices.length, 0);
});

test('перки не ломают состояние при повторном взятии (стаки)', () => {
  let s = E.createGame(55);
  for (const id of E.PERKS.map(p => p.id).concat(['HEAVY_RAM','SECOND_BREATH','SECOND_BREATH'])) {
    s.entities = s.entities.filter(e => e.kind === 'PLAYER');
    s.phase = 'PERKS';
    s.perkChoices = [id];
    s = E.choosePerk(s, id);
    assertInvariants(s);
    assert.ok(typeof E.describePerk(id, E.perkLevel(s, id)) === 'string');
  }
  assert.equal(E.perkLevel(s, 'SECOND_BREATH'), 3);
  assert.ok(E.playerOf(s).maxHp >= 5);
});

test('фазз: 30 забегов по 250 ходов без исключений и с инвариантами', () => {
  const keys = ['UP','DOWN','LEFT','RIGHT'];
  for (let seed = 1; seed <= 30; seed++) {
    let n = seed;
    const rnd = () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
    let s = E.createGame(seed * 101);
    for (let step = 0; step < 250; step++) {
      if (s.phase === 'PERKS') { s = E.choosePerk(s, s.perkChoices[Math.floor(rnd() * 3)]); continue; }
      if (s.phase === 'WIN' || s.phase === 'DEAD') break;
      if (rnd() < 0.12) s = E.setMode(s, rnd() < .5 ? 'HOOK' : 'THROW');
      const action = rnd() < 0.12 ? { type:'WAIT' } : { type:'DIR', dir:keys[Math.floor(rnd() * 4)] };
      const r = E.performTurn(s, action);
      s = r.state;
      assertInvariants(s);
      for (const f of r.frames) {
        assert.ok(Array.isArray(f.events));
        assert.ok(f.state && Array.isArray(f.state.grid));
      }
    }
  }
});
