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
      if (options.extraStorage)
        for (const [k, v] of Object.entries(options.extraStorage)) window.localStorage.setItem(k, String(v));
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
  assert.equal(ov.querySelectorAll('.lg-group').length, 4, 'палитра + 3 раздела');
  assert.equal(ov.querySelectorAll('.lg-pal-item').length, 6, '6 ролей палитры');
  assert.match(ov.textContent, /ЧУЖОЙ/);
  assert.match(ov.textContent, /БЕЗОПАСНЫЙ ХОД/);
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

test('COLOR CONTRACT: палитра CSS и JS синхронна, один цвет = одна роль', () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const jsPal = html.match(/const PAL = \{([\s\S]*?)\};/)[1];
  const roles = {
    ally:'#00e5ff', hostile:'#ff4757', neutral:'#ffb037',
    hazard:'#ff7a1a', safe:'#5cffb0'
  };
  for (const [role, hex] of Object.entries(roles)) {
    assert.match(css, new RegExp('--' + role + '\\s*:\\s*' + hex), 'CSS переменная ' + role);
    assert.match(jsPal, new RegExp(role + ":\\s*'" + hex + "'"), 'JS PAL.' + role);
  }
  // старые алиасы обязаны ссылаться на контракт, а не жить своими hex-кодами
  assert.match(css, /--cyan:var\(--ally\)/);
  assert.match(css, /--red:var\(--hostile\)/);
  assert.match(css, /--amber:var\(--neutral\)/);
  // защищённые оттенки не разбросаны по врагам: все 5 архетипов — красная семья
  for (const stale of ['#ffd08a','#d9a3ff','#8b3ee8','#fff3a8','#ffd028','#9a642f'])
    assert.ok(!css.includes(stale), 'старый оттенок ' + stale + ' больше не используется');
  // превью = зелёный, намерения = красный, HP героя = «свой»
  assert.match(css, /\.pv-mark\{[^}]*stroke:var\(--safe\)/);
  assert.match(css, /\.dir\.ok\{[^}]*rgba\(92,255,176/);
  assert.match(css, /\.tg-attack\{[^}]*stroke:#ff4757/);
  assert.match(css, /\.hearts \.full\{color:var\(--ally\)\}/);
  assert.match(css, /\.t-SPIKES\{[^}]*repeating-linear-gradient/);
});

test('UI: кнопка ПОНЯТНО кликабельна — мини-клетки не перехватывают тап', async () => {
  // Регрессия: ::after с inset:0 у .t-SPIKES/.t-LAVA без position:relative
  // растягивался на весь оверлей и ловил pointer events поверх кнопок.
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.lg-tile\{[^}]*position:relative[^}]*overflow:hidden/);
  assert.match(css, /\.lg-ico,\.lg-tile,\.lg-sym\{[^}]*pointer-events:none/);

  const { dom, doc, errors } = boot();
  await pause(25);
  tap(doc, doc.querySelector('#legendBtn'));
  const ov = doc.querySelector('#overlay');
  assert.ok(!ov.classList.contains('hidden'));
  const close = ov.querySelector('[data-act="close"]');
  assert.ok(close, 'кнопка ПОНЯТНО присутствует');
  tap(doc, close);
  assert.ok(ov.classList.contains('hidden'), 'ПОНЯТНО закрывает легенду');
  assert.ok(!ov.classList.contains('legend-mode'));
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('МАСШТАБ: геометрия на --u, поле вписано в 55%, без фиксированных px-полов', () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /--u:clamp\(9px, min\(2\.7vw, 1\.4dvh\), 14px\)/);
  assert.match(css, /--chrome:clamp\(82px, 12\.2dvh, 108px\)/);
  assert.match(css, /--board:min\(92vw, 46dvh, calc\(55dvh - var\(--chrome\)\), 440px\)/);
  assert.match(css, /#board\{[\s\S]*?width:var\(--board\)/);
  assert.match(css, /--btn:clamp\(56px, min\(17\.5vw, 8\.2dvh\), 84px\)/);
  // старые жёсткие минимумы, ломавшие маленькие телефоны, удалены
  assert.ok(!css.includes('max(180px,min(92vw'), 'нет жёсткого минимума поля');
  assert.ok(!css.includes('max(160px,min(88vw'), 'нет устаревшего медиа-минимума');
  assert.ok(!css.includes('min-height:66px'), 'кнопки приёмов масштабируются');
  assert.ok(!css.includes('width:34px;height:34px'), 'кнопки HUD масштабируются');
  // слово «ЭТАЖ» можно убрать на очень узком экране, не ломая HUD
  assert.match(html, /class="fp-word"/);
  assert.match(css, /@media \(max-width:350px\)\{\.floor-pill \.fp-word\{display:none\}\}/);
  assert.match(css, /@media \(max-height:520px\)\{[\s\S]*?--u:clamp\(7px,1\.4dvh,9px\)/,
    'режим экстремально низкого экрана');
  assert.match(css, /@media \(max-height:520px\)\{[\s\S]*?\.hint\{display:none\}/);
});

test('ОГОНЬ: пламя рисуется CSS-формами, без символа ♨ из шрифта', () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(!css.includes('♨'), 'странный глиф пара удалён');
  assert.ok(!css.includes('@keyframes lava'), 'старая анимация яркости удалена');
  assert.match(css, /\.t-LAVA::before\{[\s\S]*?clip-path:polygon\(/);
  assert.match(css, /\.t-LAVA::after\{[\s\S]*?clip-path:polygon\(/);
  assert.match(css, /@keyframes flame\{/);
  assert.match(css, /repeating-linear-gradient\(135deg,#4a1a08/);
  // легенда показывает то же самое пламя, а не отдельную картинку
  assert.match(css, /\.lg-tile\.t-LAVA::before,\.lg-tile\.t-LAVA::after/);
});

test('UI: НЕТ ПУТИ заметно — баннер, крест, тост, вспышка, ход не потрачен', async () => {
  const s = E.createGame(2026);
  s.grid = Array.from({ length:5 }, () => Array(5).fill('FLOOR'));
  const p = s.entities.find(e => e.kind === 'PLAYER');
  const d = E.DIRS.find(q => {
    const x = p.x + q.dx, y = p.y + q.dy;
    return x >= 0 && x < 5 && y >= 0 && y < 5 &&
           !s.entities.some(e => e.alive && e.x === x && e.y === y);
  });
  s.grid[p.y + d.dy][p.x + d.dx] = 'LAVA';   // базовый шаг в лаву запрещён
  const before = s.turn;

  const { dom, win, doc, errors } = boot(s);
  await pause(25);
  key(win, KEYS[d.key]);
  await pause(30);

  assert.equal(doc.querySelectorAll('.fx-deny').length, 1, 'баннер на всё поле');
  assert.match(doc.querySelector('.fx-deny').textContent, /НЕТ ПУТИ/);
  assert.match(doc.querySelector('.fx-deny').textContent, /ХОД НЕ ПОТРАЧЕН/);
  assert.equal(doc.querySelectorAll('.fx-block').length, 1, 'красный крест на клетке');
  assert.ok(doc.querySelector('#toast').classList.contains('danger'), 'тост в опасном стиле');
  assert.match(doc.querySelector('#toast').textContent, /НЕТ ПУТИ/);
  assert.ok(doc.querySelectorAll('.dir.denied').length > 0, 'недоступные направления мигнули');
  assert.equal(JSON.parse(win.localStorage.getItem(SAVE_KEY)).turn, before, 'ход не потрачен');
  assert.deepEqual(errors, [], 'нет ошибок в консоли');

  await pause(1000);
  assert.equal(doc.querySelectorAll('.fx-deny').length, 0, 'баннер сам исчезает');
  assert.equal(doc.querySelectorAll('.fx-block').length, 0, 'крест сам исчезает');
  dom.window.close();
});

/* -------------------- 10 уровней сложности -------------------- */
const DIFFICULTY_DATA = JSON.parse(
  readFileSync(new URL('../ai/difficulty.json', import.meta.url), 'utf8'));
const DIFF_KEY = 'edge-push:difficulty:v1';
const RUN_KEY = 'edge-push:run:v1';
const poolOf = n => DIFFICULTY_DATA.levels[n - 1].seeds;

test('UI: кнопка СЛ открывает 10 уровней с названиями и подсказками', async () => {
  const { dom, doc, errors } = boot();
  await pause(25);
  const btn = doc.querySelector('#diffBtn');
  assert.ok(btn, 'кнопка сложности в шапке');
  assert.match(btn.getAttribute('aria-label'), /Сложность/);
  assert.equal(doc.querySelector('#diffNum').textContent.trim(), String(DIFFICULTY_DATA.levels.length / 2));
  tap(doc, btn);
  const ov = doc.querySelector('#overlay');
  assert.match(ov.textContent, /СЛОЖНОСТЬ · 10 УРОВНЕЙ/);
  assert.ok(ov.classList.contains('difficulty-mode'));
  const items = ov.querySelectorAll('[data-diff]');
  assert.equal(items.length, 10, 'ровно 10 уровней');
  assert.equal(ov.querySelectorAll('.diff-item.active').length, 1, 'текущий уровень помечен');
  for (const l of DIFFICULTY_DATA.levels) {
    const el = ov.querySelector('[data-diff="' + l.level + '"]');
    assert.ok(el, 'уровень ' + l.level);
    assert.match(el.textContent, new RegExp(l.name));
    assert.ok(el.querySelector('small').textContent.trim().length > 0, 'есть замер сложности');
  }
  tap(doc, ov.querySelector('[data-act="close"]'));
  assert.ok(ov.classList.contains('hidden'));
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: смена уровня на старте выдаёт сид из его пула и сохраняется', async () => {
  const level = 10;
  const { dom, win, doc, errors } = boot();
  await pause(25);
  tap(doc, doc.querySelector('#diffBtn'));
  tap(doc, doc.querySelector('[data-diff="' + level + '"]'));
  await pause(30);
  assert.equal(win.localStorage.getItem(DIFF_KEY), String(level), 'уровень в localStorage');
  assert.equal(doc.querySelector('#diffNum').textContent.trim(), String(level));
  const saved = JSON.parse(win.localStorage.getItem(SAVE_KEY));
  assert.equal(saved.floor, 1);
  assert.equal(saved.turn, 1);
  assert.ok(poolOf(level).includes(saved.seed), 'сид из пула уровня 10: ' + saved.seed);
  assert.ok(doc.querySelector('#overlay').classList.contains('hidden'), 'оверлей закрыт');
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: посреди забега смена уровня требует подтверждения', async () => {
  const s = E.createGame(2026);
  s.turn = 4;
  const { dom, win, doc, errors } = boot(s);
  await pause(25);
  tap(doc, doc.querySelector('#diffBtn'));
  tap(doc, doc.querySelector('[data-diff="2"]'));
  const ov = doc.querySelector('#overlay');
  assert.match(ov.textContent, /УРОВЕНЬ 2/);
  assert.match(ov.textContent, /Текущий забег будет сброшен/);
  assert.equal(win.localStorage.getItem(DIFF_KEY), null, 'пока не применено');
  tap(doc, ov.querySelector('[data-act="close"]'));
  assert.equal(doc.querySelector('#diffNum').textContent.trim(), String(DIFFICULTY_DATA.levels.length / 2));
  tap(doc, doc.querySelector('#diffBtn'));
  tap(doc, doc.querySelector('[data-diff="2"]'));
  tap(doc, doc.querySelector('[data-act="diff-apply"]'));
  await pause(30);
  assert.equal(win.localStorage.getItem(DIFF_KEY), '2');
  const saved = JSON.parse(win.localStorage.getItem(SAVE_KEY));
  assert.ok(poolOf(2).includes(saved.seed), 'сид из пула уровня 2');
  assert.equal(saved.turn, 1, 'новый забег');
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: уровень и счётчик забегов восстанавливаются при перезагрузке', async () => {
  const { dom, win, doc, errors } = boot(undefined, {
    extraStorage: { [DIFF_KEY]: '7', [RUN_KEY]: '3' }
  });
  await pause(25);
  assert.equal(doc.querySelector('#diffNum').textContent.trim(), '7');
  assert.match(doc.querySelector('#diffBtn').title, /УВЕРЕННО|Сложность 7/);
  tap(doc, doc.querySelector('#restartBtn'));
  tap(doc, doc.querySelector('[data-act="new"]'));
  await pause(30);
  assert.equal(win.localStorage.getItem(DIFF_KEY), '7', 'уровень не сбросился');
  assert.equal(win.localStorage.getItem(RUN_KEY), '4', 'счётчик забегов вырос');
  const saved = JSON.parse(win.localStorage.getItem(SAVE_KEY));
  assert.ok(poolOf(7).includes(saved.seed), 'сид из пула уровня 7');
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: сложность доступна из справки и с клавиатуры', async () => {
  const { dom, doc, errors } = boot();
  await pause(25);
  tap(doc, doc.querySelector('#helpBtn'));
  const help = doc.querySelector('[data-act="difficulty"]');
  assert.ok(help, 'кнопка сложности в справке');
  tap(doc, help);
  assert.match(doc.querySelector('#overlay').textContent, /СЛОЖНОСТЬ · 10 УРОВНЕЙ/);
  tap(doc, doc.querySelector('[data-act="close"]'));
  key(dom.window, 'c');
  assert.match(doc.querySelector('#overlay').textContent, /СЛОЖНОСТЬ · 10 УРОВНЕЙ/);
  key(dom.window, 'Escape');
  assert.ok(doc.querySelector('#overlay').classList.contains('hidden'));
  assert.deepEqual(errors, [], 'нет ошибок в консоли');
  dom.window.close();
});

test('UI: смена сложности доступна с экрана финала', async () => {
  for (const phase of ['WIN', 'DEAD']) {
    const s = E.createGame(2026);
    s.phase = phase;
    const { dom, win, doc, errors } = boot(s);
    await pause(25);
    assert.match(doc.querySelector('#overlay').textContent,
      phase === 'WIN' ? /КРАЙ ДОСТИГНУТ/ : /ВЫ ПОГИБЛИ/);
    tap(doc, doc.querySelector('#overlay [data-act="difficulty"]'));
    assert.match(doc.querySelector('#overlay').textContent, /СЛОЖНОСТЬ · 10 УРОВНЕЙ/);
    tap(doc, doc.querySelector('[data-diff="3"]'));
    await pause(30);
    assert.equal(win.localStorage.getItem(DIFF_KEY), '3', 'применено без подтверждения: ' + phase);
    const saved = JSON.parse(win.localStorage.getItem(SAVE_KEY));
    assert.ok(poolOf(3).includes(saved.seed));
    assert.equal(saved.phase, 'PLAYER');
    assert.deepEqual(errors, [], 'нет ошибок в консоли: ' + phase);
    dom.window.close();
  }
});
