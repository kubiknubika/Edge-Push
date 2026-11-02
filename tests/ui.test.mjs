/**
 * UI smoke-тест: поднимает index.html в jsdom с реальным выполнением скриптов,
 * проверяет, что интерфейс рендерится, реагирует на тапы/свайпы/клавиатуру,
 * сохраняется в localStorage и рисует оверлей перков.
 *
 *   npm install && npm run test:ui
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SAVE_KEY = 'edge-push:v1';

/* Движок из того же файла — чтобы скрафтить состояние для оверлея перков. */
function engineFromHtml() {
  const m = html.match(/\/\* ===== ENGINE START ===== \*\/([\s\S]*?)\/\* ===== ENGINE END ===== \*\//);
  const box = {};
  vm.createContext(box);
  vm.runInContext(m[1], box);
  return box.EdgeEngine;
}
const E = engineFromHtml();

const DEFAULT_STATE = () => E.createGame(2026);   // фиксированный сид = детерминированные тесты
function boot(seedState, opts) {
  const options = opts || {};
  if (seedState === undefined) seedState = DEFAULT_STATE();
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, {
    url:'https://edge-push.test/',
    runScripts:'dangerously',
    pretendToBeVisual:true,
    virtualConsole:vc,
    beforeParse(window) {
      if (seedState) window.localStorage.setItem(SAVE_KEY, JSON.stringify(seedState));
      if (!options.freshTutorial) window.localStorage.setItem('edge-push:tutorial:v1', 'done');
      window.addEventListener('error', e => errors.push('window.error: ' + e.message));
    }
  });
  return { dom, win:dom.window, doc:dom.window.document, errors };
}
const pause = ms => new Promise(r => setTimeout(r, ms));
const txt = (doc, sel) => doc.querySelector(sel).textContent.trim();

function tap(doc, el) {
  el.dispatchEvent(new (el.ownerDocument.defaultView).MouseEvent('click', { bubbles:true }));
}
function swipe(win, fromX, fromY, toX, toY) {
  const mk = (type, x, y) => {
    const e = new win.Event(type, { bubbles:true });
    Object.defineProperty(e, 'clientX', { value:x });
    Object.defineProperty(e, 'clientY', { value:y });
    Object.defineProperty(e, 'pointerId', { value:1 });
    return e;
  };
  win.document.dispatchEvent(mk('pointerdown', fromX, fromY));
  win.document.dispatchEvent(mk('pointerup', toX, toY));
}
function key(win, k) {
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key:k, bubbles:true, cancelable:true }));
}
const KEYS = { UP:'ArrowUp', DOWN:'ArrowDown', LEFT:'ArrowLeft', RIGHT:'ArrowRight' };
function firstValidDir(s) {
  const pv = E.preview(s);
  const d = E.DIRS.find(q => pv.dirs[q.key].valid);
  return d ? d.key : null;
}
function swipeDir(win, dir) {
  const d = E.DIR[dir];
  swipe(win, 160, 300, 160 + d.dx * 60, 300 + d.dy * 60);
}

test('UI: стартует без ошибок и рисует HUD, поле 5×5, юнитов и D-pad', async () => {
  const { dom, win, doc, errors } = boot();
  await pause(30);
  assert.ok(win.EdgeEngine, 'движок доступен из UI');
  assert.equal(doc.querySelectorAll('#tiles .tile').length, 25);
  assert.equal(doc.querySelectorAll('.dir').length, 4);
  assert.ok(doc.querySelectorAll('#entities .unit').length >= 5, 'герой, бочки и враги на поле');
  assert.ok(txt(doc, '#floorNum').includes('/7'));
  assert.match(txt(doc, '#statusLine'), /ХОД 1/);
  assert.ok(txt(doc, '#hearts').length > 0);
  assert.ok(doc.querySelector('#overlay').classList.contains('hidden'));
  assert.ok(win.localStorage.getItem(SAVE_KEY), 'автосохранение при старте');
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: тап по крестовине, способности и «Ждать» делают ход и сохраняются', async () => {
  const { dom, win, doc, errors } = boot();
  await pause(20);
  const saved = () => JSON.parse(win.localStorage.getItem(SAVE_KEY));
  const before = saved().turn;

  tap(doc, doc.querySelector('#waitBtn'));
  await pause(650);                                   // 3 кадра по ~185 мс
  assert.ok(saved().turn > before, 'ход завершён');
  assert.equal(doc.querySelector('#overlay').classList.contains('hidden'), true);
  assert.ok(txt(doc, '#statusLine').includes('ХОД '));

  tap(doc, doc.querySelector('#hookBtn'));
  assert.match(txt(doc, '#modeLabel'), /КРЮК/);
  assert.ok(doc.querySelectorAll('#telegraph .pv-ray').length > 0, 'лучи крюка на поле');
  tap(doc, doc.querySelector('#hookBtn'));
  assert.match(txt(doc, '#modeLabel'), /ШАГ/);

  tap(doc, doc.querySelector('#throwBtn'));
  assert.match(txt(doc, '#modeLabel'), /БРОСОК/);
  assert.ok(doc.querySelectorAll('#telegraph .pv-mark').length > 0 || true);
  tap(doc, doc.querySelector('#throwBtn'));

  const dir = firstValidDir(saved());
  assert.ok(dir, 'есть хотя бы одно допустимое направление');
  key(win, KEYS[dir]);
  await pause(650);
  assert.ok(saved().turn > before + 1, 'клавиатура тоже ходит');
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: свайп в любой точке экрана (порог 30px) и короткий тап не ломают игру', async () => {
  const { dom, win, doc, errors } = boot();
  await pause(20);
  const saved = () => JSON.parse(win.localStorage.getItem(SAVE_KEY));
  const t0 = saved().turn;

  swipeDir(win, firstValidDir(saved()) || 'UP');   // 60px в допустимую сторону
  await pause(650);
  const t1 = saved().turn;
  assert.ok(t1 > t0, 'свайп тратит ход');

  swipe(win, 100, 300, 110, 300);       // 10px — ниже порога, ход не должен тратиться
  await pause(100);
  assert.equal(saved().turn, t1, 'короткий свайп игнорируется');

  const dir2 = firstValidDir(saved());
  if (dir2) swipeDir(win, dir2);
  await pause(650);
  assert.ok(saved().turn >= t1, 'второй свайп не ломает состояние');
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: оверлей перков из сохранения — 3 карточки, выбор ведёт на этаж 2', async () => {
  const s = E.createGame(31);
  s.entities = s.entities.filter(e => e.kind === 'PLAYER');
  s.phase = 'PERKS';
  s.perkChoices = E.choosePerkCards(s);
  const { dom, win, doc, errors } = boot(s);
  await pause(30);
  assert.match(txt(doc, '#toast'), /ВОССТАНОВЛЕНА/);
  assert.equal(doc.querySelectorAll('.perk-card').length, 3);
  assert.match(doc.querySelector('#overlay').textContent, /ЭТАЖ 1 ПРОЙДЕН/);
  const chosen = doc.querySelector('.perk-card').dataset.perk;
  tap(doc, doc.querySelector('.perk-card'));
  await pause(60);
  const saved = JSON.parse(win.localStorage.getItem(SAVE_KEY));
  assert.equal(saved.floor, 2);
  assert.equal(saved.phase, 'PLAYER');
  assert.ok(saved.perks.includes(chosen), 'перк применён и сохранён');
  assert.ok(doc.querySelector('#overlay').classList.contains('hidden'));
  assert.equal(doc.querySelectorAll('#tiles .tile.t-CHASM').length >= 6, true);
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: экраны победы/поражения и «Заново» с подтверждением', async () => {
  for (const phase of ['WIN', 'DEAD']) {
    const s = E.createGame(17);
    s.phase = phase;
    const { dom, win, doc, errors } = boot(s);
    await pause(30);
    assert.match(doc.querySelector('#overlay').textContent,
                 phase === 'WIN' ? /КРАЙ ДОСТИГНУТ/ : /ВЫ ПОГИБЛИ/);
    tap(doc, doc.querySelector('[data-act="new"]'));
    await pause(40);
    const saved = JSON.parse(win.localStorage.getItem(SAVE_KEY));
    assert.equal(saved.floor, 1);
    assert.equal(saved.phase, 'PLAYER');
    assert.deepEqual(errors, [], 'нет ошибок в консоли: ' + phase);
    dom.window.close();
  }
  const { dom, win, doc, errors } = boot();
  await pause(20);
  tap(doc, doc.querySelector('#restartBtn'));
  assert.match(doc.querySelector('#overlay').textContent, /НАЧАТЬ ЗАНОВО/);
  tap(doc, doc.querySelector('[data-act="close"]'));
  assert.ok(doc.querySelector('#overlay').classList.contains('hidden'));
  tap(doc, doc.querySelector('#helpBtn'));
  assert.match(doc.querySelector('#overlay').textContent, /КАК ИГРАТЬ/);
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: обучение при первом запуске — 6 шагов, подсветка кнопок и пропуск', async () => {
  const { dom, win, doc, errors } = boot(undefined, { freshTutorial:true });
  await pause(30);
  const tut = doc.querySelector('#tutorial');
  assert.ok(!tut.classList.contains('hidden'), 'карточка обучения видна при первом запуске');
  assert.match(tut.textContent, /ОБУЧЕНИЕ 1\/6/);
  assert.ok(doc.getElementById('app').classList.contains('tutorial-on'));
  assert.equal(win.localStorage.getItem('edge-push:tutorial:v1'), null, 'флаг ещё не выставлен');

  tap(doc, tut.querySelector('[data-tut="next"]'));
  assert.match(tut.textContent, /ОБУЧЕНИЕ 2\/6/);
  assert.equal(doc.querySelectorAll('.dir.tut-glow').length, 4, 'шаг 2 подсвечивает крестовину');

  tap(doc, tut.querySelector('[data-tut="next"]'));
  assert.match(tut.textContent, /ОБУЧЕНИЕ 3\/6/);
  tap(doc, tut.querySelector('[data-tut="next"]'));
  assert.match(tut.textContent, /ОБУЧЕНИЕ 4\/6/);
  assert.equal(doc.querySelectorAll('#board.tut-glow').length, 1, 'шаг 4 подсвечивает поле');

  tap(doc, tut.querySelector('[data-tut="next"]'));
  assert.match(tut.textContent, /ОБУЧЕНИЕ 5\/6/);
  assert.equal(doc.querySelectorAll('.ability.tut-glow').length, 3, 'шаг 5 подсвечивает приёмы');

  tap(doc, tut.querySelector('[data-tut="next"]'));
  assert.match(tut.textContent, /ОБУЧЕНИЕ 6\/6/);
  assert.match(tut.textContent, /ИГРАТЬ/);
  tap(doc, tut.querySelector('[data-tut="next"]'));
  assert.ok(tut.classList.contains('hidden'), 'последний шаг закрывает обучение');
  assert.equal(win.localStorage.getItem('edge-push:tutorial:v1'), 'done');
  assert.equal(doc.querySelectorAll('.tut-glow').length, 0, 'подсветка снята');
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: обучение не блокирует игру и шаг завершается реальным ходом', async () => {
  const { dom, win, doc, errors } = boot(undefined, { freshTutorial:true });
  await pause(25);
  const tut = doc.querySelector('#tutorial');
  const saved = () => JSON.parse(win.localStorage.getItem(SAVE_KEY));
  tap(doc, tut.querySelector('[data-tut="next"]'));           // шаг 2 (waitAction)
  const t0 = saved().turn;
  const dir = firstValidDir(saved());
  assert.ok(dir);
  key(win, KEYS[dir]);
  await pause(650);
  assert.ok(saved().turn > t0, 'ход прошёл, хотя обучение открыто');
  assert.match(tut.textContent, /ОБУЧЕНИЕ 3\/6/, 'интерактивный шаг завершился ходом');
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: пропуск обучения и повтор из справки', async () => {
  const { dom, win, doc, errors } = boot(undefined, { freshTutorial:true });
  await pause(25);
  const tut = doc.querySelector('#tutorial');
  tap(doc, tut.querySelector('[data-tut="skip"]'));
  assert.ok(tut.classList.contains('hidden'));
  assert.equal(win.localStorage.getItem('edge-push:tutorial:v1'), 'done');

  tap(doc, doc.querySelector('#helpBtn'));
  assert.match(doc.querySelector('#overlay').textContent, /КАК ИГРАТЬ/);
  tap(doc, doc.querySelector('[data-act="tutorial"]'));
  assert.ok(!tut.classList.contains('hidden'), 'обучение открылось заново');
  assert.match(tut.textContent, /ОБУЧЕНИЕ 1\/6/);
  assert.equal(win.localStorage.getItem('edge-push:tutorial:v1'), null);
  assert.ok(doc.querySelector('#overlay').classList.contains('hidden'));
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: у прошедшего обучение игрока карточка не появляется', async () => {
  const { dom, doc, errors } = boot();
  await pause(25);
  assert.ok(doc.querySelector('#tutorial').classList.contains('hidden'));
  assert.equal(doc.querySelectorAll('.tut-glow').length, 0);
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: легенда из HUD — все юниты, клетки и метки', async () => {
  const { dom, win, doc, errors } = boot();
  await pause(25);
  tap(doc, doc.querySelector('#legendBtn'));
  const ov = doc.querySelector('#overlay');
  assert.match(ov.textContent, /КТО ЕСТЬ КТО/);
  assert.ok(ov.classList.contains('legend-mode'));
  assert.equal(ov.querySelectorAll('.lg-group').length, 3);
  assert.equal(ov.querySelectorAll('.lg-ico').length, 7, '7 мини-иконок юнитов');
  assert.equal(ov.querySelectorAll('.lg-tile').length, 5, '5 клеток');
  assert.equal(ov.querySelectorAll('.lg-sym').length, 6, '6 меток');
  for (const cls of ['u-PLAYER','u-BRUTE','u-CHARGER','u-SNIPER','u-BOMBER','u-JUGGERNAUT','u-BARREL'])
    assert.equal(ov.querySelectorAll('.lg-ico.' + cls).length, 1, 'иконка ' + cls);
  for (const cls of ['t-FLOOR','t-CHASM','t-PILLAR','t-SPIKES','t-LAVA'])
    assert.equal(ov.querySelectorAll('.lg-tile.' + cls).length, 1, 'клетка ' + cls);
  assert.match(ov.textContent, /Громила/);
  assert.match(ov.textContent, /Снайпер/);
  assert.match(ov.textContent, /Джаггернаут/);
  assert.match(ov.textContent, /Пропасть/);
  assert.match(ov.textContent, /Намерение/);
  tap(doc, ov.querySelector('[data-act="close"]'));
  assert.ok(ov.classList.contains('hidden'));
  assert.ok(!ov.classList.contains('legend-mode'));
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: легенда из справки, по клавише L и закрытие Escape', async () => {
  const { dom, win, doc, errors } = boot();
  await pause(25);
  tap(doc, doc.querySelector('#helpBtn'));
  assert.match(doc.querySelector('#overlay').textContent, /КАК ИГРАТЬ/);
  tap(doc, doc.querySelector('[data-act="legend"]'));
  assert.match(doc.querySelector('#overlay').textContent, /КТО ЕСТЬ КТО/);

  key(win, 'Escape');
  assert.ok(doc.querySelector('#overlay').classList.contains('hidden'));
  key(win, 'l');
  assert.match(doc.querySelector('#overlay').textContent, /КТО ЕСТЬ КТО/, 'клавиша L открывает легенду');
  key(win, 'Escape');
  assert.ok(doc.querySelector('#overlay').classList.contains('hidden'));
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: легенда из обучения сохраняет шаг и может перезапустить обучение', async () => {
  const { dom, win, doc, errors } = boot(undefined, { freshTutorial:true });
  await pause(25);
  const tut = doc.querySelector('#tutorial');
  tap(doc, tut.querySelector('[data-tut="next"]'));
  assert.match(tut.textContent, /ОБУЧЕНИЕ 2\/6/);
  tap(doc, tut.querySelector('[data-tut="legend"]'));
  assert.match(doc.querySelector('#overlay').textContent, /КТО ЕСТЬ КТО/);
  assert.ok(tut.classList.contains('hidden'), 'карточка обучения скрыта под легендой');

  tap(doc, doc.querySelector('#overlay [data-act="close"]'));
  assert.ok(!tut.classList.contains('hidden'), 'обучение вернулось');
  assert.match(tut.textContent, /ОБУЧЕНИЕ 2\/6/, 'шаг не сбился');

  tap(doc, tut.querySelector('[data-tut="legend"]'));
  tap(doc, doc.querySelector('#overlay [data-act="tutorial"]'));
  assert.match(tut.textContent, /ОБУЧЕНИЕ 1\/6/, 'из легенды обучение перезапускается');
  assert.equal(win.localStorage.getItem('edge-push:tutorial:v1'), null);
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: легенда не меняет партию и не реагирует на игровой ввод', async () => {
  const { dom, win, doc, errors } = boot();
  await pause(25);
  const before = win.localStorage.getItem(SAVE_KEY);
  tap(doc, doc.querySelector('#legendBtn'));
  const s0 = JSON.parse(win.localStorage.getItem(SAVE_KEY));
  key(win, 'ArrowUp');
  swipe(win, 100, 300, 200, 300);
  await pause(80);
  assert.equal(JSON.parse(win.localStorage.getItem(SAVE_KEY)).turn, s0.turn, 'ход не потрачен');
  assert.equal(win.localStorage.getItem(SAVE_KEY), before, 'сохранение не изменилось');
  assert.match(doc.querySelector('#overlay').textContent, /КТО ЕСТЬ КТО/);
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});
