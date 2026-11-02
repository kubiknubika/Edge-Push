/**
 * Собирает самодостаточный ai/index.html: график эволюции, сравнение политик,
 * вердикт о проходимости и пошаговый реплей выигрышной партии.
 * Без внешних библиотек и без сети: все данные встроены в HTML.
 *
 *   node ai/report.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = f => JSON.parse(readFileSync(resolve('ai/' + f), 'utf8'));
const training = read('training.json');
const results = read('results.json');
const replay = read('replay.json');
const html = readFileSync(resolve('index.html'), 'utf8');
const engineSrc = html.match(/\/\* ===== ENGINE START ===== \*\/([\s\S]*?)\/\* ===== ENGINE END ===== \*\//)[1];
const perkTitles = Object.fromEntries(
  Array.from(engineSrc.matchAll(/id:'([A-Z_]+)',\s*icon:'[^']*',\s*title:'([^']+)'/g)).map(m => [m[1], m[2]])
);

const data = { training, results, replay, perkTitles };
const json = JSON.stringify(data).replace(/</g, '\\u003c');

const h = training.history;
const calMax = Math.max(...h.map(x => Math.max(x.best, x.genBest)));
const meanMax = Math.max(...h.map(x => x.mean));
const n = h.length;

function poly(values, w, ht, pad, max = Math.max(...values)) {
  return values.map((v, i) => {
    const x = pad + (w - 2 * pad) * (n === 1 ? 0 : i / (n - 1));
    const y = ht - pad - (ht - 2 * pad) * (v / (max || 1));
    return +x.toFixed(1) + ',' + +y.toFixed(1);
  }).join(' ');
}
function chart(valuesA, valuesB, labelA, labelB, colorA, colorB, max, unit = '') {
  const hasB = !!valuesB;
  const w = 720, ht = 220, pad = 34;
  const grid = [0, .25, .5, .75, 1].map(t => {
    const y = +(ht - pad - (ht - 2 * pad) * t).toFixed(1);
    const label = +(max * t).toFixed(0) + unit;
    return `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" class="grid"/>` +
           `<text x="${pad - 6}" y="${y + 4}" class="axis" text-anchor="end">${label}</text>`;
  }).join('');
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => {
    const x = +(pad + (w - 2 * pad) * (n === 1 ? 0 : i / (n - 1))).toFixed(1);
    return `<text x="${x}" y="${ht - 8}" class="axis" text-anchor="middle">${h[i].gen}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${ht}" role="img" aria-label="${labelA} и ${labelB} по поколениям">
    ${grid}${ticks}
    ${hasB ? `<polyline points="${poly(valuesB, w, ht, pad, max)}" fill="none" stroke="${colorB}" stroke-width="2.5" stroke-dasharray="6 4"/>` : ''}
    <polyline points="${poly(valuesA, w, ht, pad, max)}" fill="none" stroke="${colorA}" stroke-width="3"/>
    <text x="${w - pad}" y="18" class="lg" text-anchor="end" fill="${colorA}">■ ${labelA}</text>
    ${hasB ? `<text x="${w - pad}" y="36" class="lg" text-anchor="end" fill="${colorB}">□ ${labelB}</text>` : ''}
    <text x="${pad}" y="18" class="axis">поколение →</text>
  </svg>`;
}

const fitChart = chart(h.map(x => x.best), h.map(x => x.genBest),
  'лучший за всё время', 'лучший поколения', '#00e5ff', '#ffb037', calMax);
const meanChart = chart(h.map(x => x.mean), null,
  'среднее по популяции (обучающие сиды поколения)', null, '#ffb037', null, meanMax);
const progChart = chart(h.map(x => x.avgFloors), h.map(x => x.winRate * 7),
  'среднее пройдено этажей', 'победы ×7 (масштаб)', '#5cffb0', '#ff4757', 7);

const pol = results.policies;
const G = results.guidedSearch;
const bars = [
  ...pol.map(p => ({ name: p.name, rate: p.winRate, floors: p.avgFloors, color: '#8b96ad' })),
  { name: `Стохастический поиск (${results.config.guidedAttempts} попыток)`, rate: G.guidedRate,
    floors: null, color: '#ffb037' },
  { name: `Поиск лучом (W=${results.config.beamWidth})`, rate: G.beamRate,
    floors: G.beamAvgFloors, color: '#5cffb0' },
  { name: 'Объединённый поиск', rate: G.winRate, floors: null, color: '#00e5ff' }
];
bars[3].color = '#00e5ff';
const barsHtml = bars.map((b, i) => `
  <div class="bar-row">
    <div class="bar-label">${b.name}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0.6, b.rate * 100)}%;background:${b.color}"></div></div>
    <div class="bar-val">${(b.rate * 100).toFixed(0)}%</div>
    <div class="bar-sub">${b.floors === null ? 'верхняя оценка' : 'ср. ' + b.floors + '/7'}</div>
  </div>`).join('');

const champ = pol[3];
const dist = champ.floorDistribution;
const distMax = Math.max(...dist, 1);
const distHtml = dist.map((v, i) => `
  <div class="dist-col"><div class="dist-bar" style="height:${(v / distMax * 100).toFixed(1)}%;background:${i === 7 ? '#5cffb0' : '#00e5ff'}"></div>
  <div class="dist-n">${v}</div><div class="dist-l">${i === 7 ? 'ПОБЕДА' : i + ' эт.'}</div></div>`).join('');

const passable = results.verdict === 'PASSABLE';
const union = G.unionWins;
const total = results.config.seedCount;
const verdictTitle = passable ? 'ДА, ИГРА ПРОХОДИМА' : 'ВЫИГРЫШ НЕ НАЙДЕН';
const verdictText = passable
  ? `На <b>${total}</b> сидах, которые не участвовали в обучении, для <b>${union}</b> из них найдена
     конкретная выигрышная последовательность ходов (её можно посмотреть в реплее ниже).
     Игра детерминирована: сид задаёт все 7 этажей, поэтому воспроизведённый реплей —
     конструктивное доказательство проходимости как минимум для этих сидов.
     Из них ${G.guidedWins} нашли стохастические прогоны и ${G.beamWins} — поиск лучом;
     сам чемпион выиграл с первой попытки ${G.championWins} партий.`
  : 'Поиск с заданным бюджетом не нашёл выигрышной траектории. Это <b>не</b> доказательство непроходимости: ' +
    'пространство ходов конечно, но полный перебор здесь не проводился.';
const caveat = union < total
  ? `Для остальных ${total - union} сидов ${results.config.guidedAttempts} стохастических попыток и луч шириной
     ${results.config.beamWidth} не дали победы — это ограничение бюджета поиска, а не доказательство,
     что сид непроходим. Поиск лучом в среднем доходил до ${G.beamAvgFloors}/7 этажей.`
  : `Выигрышная траектория найдена для каждого из ${total} проверенных сидов.`;

const featureRows = training.features.map((f, i) =>
  `<tr><td class="mono">${String(i + 1).padStart(2, '0')}</td><td class="mono">${f.key}</td><td>${f.desc}</td>
   <td class="mono num">${(+training.champion.w[i]).toFixed(3)}</td></tr>`).join('');
const perkRows = Object.entries(perkTitles).map(([id, title], i) =>
  `<tr><td class="mono">${String(training.features.length + 1 + i).padStart(2, '0')}</td><td class="mono">${id}</td>
   <td>перк: ${title}</td><td class="mono num">${(+training.champion.perk[i]).toFixed(3)}</td></tr>`).join('');

const first = h[0], last = h[n - 1];
const gain = ((last.best / Math.max(1, first.best) - 1) * 100).toFixed(0);

const page = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>КРАЙ · эволюционный ИИ и проходимость</title>
<style>
  :root{--bg:#080b12;--card:#111824;--line:rgba(160,180,215,.16);--ink:#e8edf7;--muted:#8b96ad;
    --ally:#00e5ff;--hostile:#ff4757;--neutral:#ffb037;--hazard:#ff7a1a;--safe:#5cffb0}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:28px 18px 70px}
  a{color:var(--ally)}
  h1{font-size:clamp(24px,5vw,38px);letter-spacing:.06em;margin:0 0 6px}
  h2{font-size:19px;letter-spacing:.08em;color:var(--ally);margin:38px 0 14px;text-transform:uppercase}
  h3{font-size:15px;letter-spacing:.06em;margin:24px 0 10px;color:var(--neutral)}
  p{margin:10px 0}.muted{color:var(--muted)}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin:14px 0}
  .verdict{border:2px solid ${passable ? 'var(--safe)' : 'var(--hostile)'};
    background:linear-gradient(135deg,rgba(92,255,176,.09),rgba(0,229,255,.04));
    padding:22px;border-radius:18px}
  .badge{display:inline-block;font-weight:900;letter-spacing:.12em;font-size:13px;padding:6px 12px;
    border-radius:999px;background:${passable ? 'rgba(92,255,176,.16)' : 'rgba(255,71,87,.16)'};
    color:${passable ? 'var(--safe)' : 'var(--hostile)'};border:1px solid currentColor}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}
  .kpi{background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:12px;padding:12px}
  .kpi b{display:block;font-size:24px;color:var(--ally);line-height:1.2}
  .kpi span{font-size:12px;color:var(--muted)}
  svg{width:100%;height:auto;display:block}
  svg .grid{stroke:rgba(160,180,215,.12);stroke-width:1}
  svg .axis{fill:#8b96ad;font-size:10px;font-family:ui-monospace,monospace}
  svg .lg{font-size:11px;font-weight:800;font-family:inherit}
  .bar-row{display:grid;grid-template-columns:minmax(150px,1.5fr) 3fr 46px 88px;gap:10px;align-items:center;margin:9px 0}
  .bar-label{font-size:13px}.bar-track{height:14px;background:rgba(255,255,255,.06);border-radius:8px;overflow:hidden}
  .bar-fill{height:100%;border-radius:8px}.bar-val{font-weight:900;color:var(--ink);text-align:right}
  .bar-sub{font-size:11px;color:var(--muted)}
  .dist{display:flex;gap:8px;align-items:flex-end;height:170px}
  .dist-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%}
  .dist-bar{width:100%;min-height:2px;border-radius:4px 4px 0 0;opacity:.85}
  .dist-n{font-size:11px;margin-top:4px}.dist-l{font-size:9px;color:var(--muted);white-space:nowrap}
  table{width:100%;min-width:430px;border-collapse:collapse;font-size:13px}
  .table-card{overflow-x:auto}
  td,th{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left}
  th{color:var(--ally);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
  td.num{text-align:right}
  /* --- поле реплея --- */
  .replay{display:grid;grid-template-columns:minmax(240px,330px) 1fr;gap:18px}
  @media(max-width:700px){
    .wrap{padding:18px 12px 50px}
    .replay{grid-template-columns:1fr}
    .bar-row{grid-template-columns:1fr 1.4fr 40px}
    .bar-sub{grid-column:1/-1;margin-top:-6px}
    .kpi b{font-size:20px}
    .card{padding:14px}
  }
  #board{display:grid;grid-template-columns:repeat(5,1fr);gap:3px;aspect-ratio:1/1;
    background:#0d111c;padding:6px;border-radius:12px;border:1px solid var(--line)}
  .cell{position:relative;border-radius:5px;overflow:hidden;display:grid;place-items:center}
  .t-FLOOR{background:linear-gradient(180deg,#2c3244,#1d2231)}
  .t-CHASM{background:#080a11;box-shadow:inset 0 0 0 1px rgba(160,180,215,.22);
    background-image:radial-gradient(circle at 50% 50%,#131a28,#06070c 75%)}
  .t-PILLAR{background:linear-gradient(135deg,#5c6880,#2b3345)}
  .t-SPIKES{background:repeating-linear-gradient(135deg,#6a2c0c 0 5px,#3a1707 5px 10px)}
  .t-LAVA{background:repeating-linear-gradient(135deg,#4a1a08 0 6px,#341105 6px 12px)}
  .t-LAVA::before{content:"";position:absolute;left:22%;right:22%;bottom:6%;height:66%;
    background:linear-gradient(180deg,#ffe6a0,#ff7a1a 65%,#c43a06);
    clip-path:polygon(50% 0%,66% 20%,60% 38%,80% 52%,72% 78%,82% 100%,18% 100%,28% 78%,20% 52%,40% 38%,34% 20%)}
  .u{position:relative;width:74%;height:74%;display:grid;place-items:center;color:#fff;
    font:900 11px/1 ui-monospace,monospace;text-shadow:0 1px 2px #000;z-index:1}
  .u.player{background:var(--ally);border-radius:22%;box-shadow:0 0 12px rgba(0,229,255,.7)}
  .u.barrel{background:var(--neutral);border-radius:18%;color:#2a1700}
  .u.enemy{background:var(--hostile);box-shadow:0 0 10px rgba(255,71,87,.6)}
  .u.BRUTE{border-radius:22%}.u.CHARGER{clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
  .u.SNIPER{clip-path:polygon(50% 0,100% 100%,0 100%)}
  .u.BOMBER{border-radius:50%}.u.JUGGERNAUT{border-radius:18%;border:2px solid #fff}
  .u .pip{position:absolute;bottom:-7px;display:flex;gap:2px}
  .u .pip i{width:4px;height:4px;border-radius:50%;background:#fff;box-shadow:0 0 3px #000}
  .u.active::after{content:"⚡";position:absolute;top:-13px;right:-6px;font-size:11px;color:var(--neutral)}
  .ctrl{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}
  button{font:700 12px/1 inherit;letter-spacing:.05em;background:rgba(0,229,255,.12);
    border:1px solid var(--ally);color:var(--ink);border-radius:10px;padding:9px 13px;cursor:pointer}
  button.ghost{border-color:var(--line);background:rgba(255,255,255,.04)}
  button:active{transform:scale(.96)}
  input[type=range]{width:100%;accent-color:var(--ally)}
  .act{font:900 15px/1.4 ui-monospace,monospace;color:var(--neutral);margin:6px 0}
  .statline{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
  .chip{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:4px 10px;color:var(--muted)}
  .note{border-left:3px solid var(--neutral);padding-left:12px;color:var(--muted);font-size:13px}
  footer{margin-top:40px;color:var(--muted);font-size:12px;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <p class="muted mono">КРАЙ / EDGE PUSH · ЭВОЛЮЦИОННЫЙ ИИ · ОТЧЁТ</p>
  <h1>Проходима ли игра?</h1>
  <p class="muted">ИИ обучался с нуля генетическим алгоритмом, играя тем же детерминированным движком,
  что и браузерная версия. Проверка — на сидах, которых он никогда не видел.</p>

  <div class="card verdict">
    <span class="badge">${verdictTitle}</span>
    <p>${verdictText}</p>
    <p class="note">${caveat}</p>
    <div class="kpis">
      <div class="kpi"><b>${(champ.winRate * 100).toFixed(0)}%</b><span>побед чемпиона с первой попытки (${champ.wins}/${champ.seeds})</span></div>
      <div class="kpi"><b>${union}/${total}</b><span>сидов с найденной выигрышной траекторией</span></div>
      <div class="kpi"><b>${n}</b><span>поколений эволюции</span></div>
      <div class="kpi"><b>+${gain}%</b><span>прирост лучшей приспособленности</span></div>
    </div>
    <p class="muted" style="font-size:12px">Обучение: ${training.config.population} геномов × ${results.training.seedsPerGen} сидов на поколение
      (пул ${results.training.seedPoolSize}) × ${training.config.maxTurns} ходов, ${training.seconds}с; чемпион отобран по
      ${results.training.calibrationSeeds} калибровочным сидам. Проверка: сиды ${results.config.heldOutSeeds[0]}–${results.config.heldOutSeeds[1]},
      лимит ${results.config.maxTurns} ходов, ${results.config.guidedAttempts} попыток + луч W=${results.config.beamWidth} на сид.</p>
  </div>

  <h2>1. ИИ действительно учится</h2>
  <p>Приспособленность — это сыгранная партия: 1200 очков за этаж, 6000 за победу, бонусы за убийства
  и живое HP, штрафы за гибель и затягивание. Старт — случайные веса. Лучшая линия снята на
  калибровочных сидах (отбор по ним не идёт), средняя — на обучающих сидах текущего поколения.</p>
  <div class="card">${fitChart}
    <p class="muted" style="font-size:12px">Обе линии — приспособленность на калибровочных сидах:
    рекорд за всё время ${first.best} → ${last.best}, лучший геном конкретного поколения
    ${first.genBest} → ${last.genBest}. σ мутации: ${first.sigma} → ${last.sigma}.</p>
  </div>
  <div class="card">${meanChart}
    <p class="muted" style="font-size:12px">Среднее по всей популяции на обучающих сидах
    ${first.mean} → ${last.mean} (сиды ротируются, поэтому линия шумная). Учится не один
    «счастливчик», а вся популяция.</p>
  </div>
  <div class="card">${progChart}
    <p class="muted" style="font-size:12px">Среднее число пройденных этажей: ${first.avgFloors} → ${last.avgFloors}/7;
    побед на калибровочных сидах: ${first.wins} → ${last.wins}/${results.training.calibrationSeeds}.</p>
  </div>

  <h2>2. Сравнение политик</h2>
  <div class="card">${barsHtml}
    <p class="muted" style="font-size:12px">Поиск — это не обучение, а ответ на вопрос «существует ли выигрышная
    линия?». Стохастический поиск делает ${results.config.guidedAttempts} прогонов по softmax-оценкам политики;
    поиск лучом шириной ${results.config.beamWidth} расширяет ${results.config.beamBranch} лучших действий на состояние.
    Оба направляются одной и той же обученной функцией ценности.</p>
  </div>
  <div class="card table-card">
    <table><thead><tr><th>Политика</th><th>Побед</th><th>Ср. этажей</th><th>Ср. убийств</th><th>Ср. фитнес</th></tr></thead>
    <tbody>${pol.map(p => `<tr><td>${p.name}</td><td>${p.wins}/${p.seeds}</td><td>${p.avgFloors}/7</td>
      <td>${p.avgKills}</td><td>${p.avgFitness}</td></tr>`).join('')}</tbody></table>
  </div>
  <h3>Как далеко дошёл чемпион на ${total} новых сидах</h3>
  <div class="card"><div class="dist">${distHtml}</div></div>

  <h2>3. Реплей выигрышной партии</h2>
  <p class="muted">Сид <b class="mono">${replay.seed}</b>, ${replay.turns} ходов, ${replay.floors}/7 этажей,
  ${replay.kills} убийств. Источник: ${replay.source}. Каждый кадр — состояние <i>перед</i> ходом.</p>
  <div class="card replay">
    <div>
      <div id="board"></div>
      <div class="ctrl">
        <button id="play">▶ ВОСПРОИЗВЕСТИ</button>
        <button id="prev" class="ghost">← ШАГ</button>
        <button id="next" class="ghost">ШАГ →</button>
        <button id="speed" class="ghost">СКОРОСТЬ ×1</button>
      </div>
      <input type="range" id="seek" min="0" max="${replay.trace.length + (replay.final ? 1 : 0) - 1}" value="0">
      <div class="muted mono" id="counter"></div>
    </div>
    <div>
      <div class="act" id="action"></div>
      <div class="statline" id="stats"></div>
      <p class="muted" style="font-size:12px">Бирюзовый ◇ — герой, красные фигуры — враги (форма = архетип),
      янтарный блок — бочка, ⚡ — активная угроза. Цвета и формы повторяют игровую легенду.</p>
      <p class="note">Реплей целиком воспроизводим: движок детерминирован, действие выбрано обученной
      политикой. Это не «картинка для примера», а реальная последовательность ходов движка.</p>
    </div>
  </div>

  <h2>4. Как устроен ИИ</h2>
  <div class="card">
    <p><b>Геном.</b> ${results.featureCount} весов линейной оценки действия и ${Object.keys(perkTitles).length} весов перков —
    всего ${results.genomeSize} генов. На каждом ходу ИИ перебирает все легальные действия
    (4 направления × 3 режима, «ждать», выбор перка), честно проигрывает каждое полным ходом движка
    (включая фазу врагов) и выбирает максимум <span class="mono">Q(s,a) = w · φ(s,a)</span>.</p>
    <p><b>Эволюция.</b> Турнирный отбор (${training.config.tournament}), элитизм ${training.config.elite},
    смешанное скрещивание ${training.config.crossoverRate}, гауссова мутация
    ${training.config.mutationRate} с убыванием σ ${training.config.sigmaStart} → ${training.config.sigmaEnd},
    ${training.config.immigrants} случайных иммигранта на поколение. Никаких учителей, градиентов,
    A*, MCTS и подсмотренных правил: веса подбираются только по исходам целых партий.</p>
    <p><b>Честность.</b> Обучение идёт на ротирующемся пуле из ${results.training.seedPoolSize} сидов
    (по ${results.training.seedsPerGen} на поколение), чемпион выбирается по отдельным
    ${results.training.calibrationSeeds} калибровочным сидам, а итоговая проверка — на третьей,
    полностью невидимой выборке ${results.config.heldOutSeeds[0]}–${results.config.heldOutSeeds[1]}.
    ГПСЧ эволюции зафиксирован (${training.config.seed}), прогон воспроизводим, политика детерминирована.</p>
  </div>
  <details class="card table-card"><summary class="mono" style="cursor:pointer;color:var(--ally)">Веса чемпиона (${results.genomeSize} генов)</summary>
    <table><thead><tr><th>№</th><th>Ген</th><th>Смысл</th><th style="text-align:right">Вес</th></tr></thead>
    <tbody>${featureRows}${perkRows}</tbody></table>
  </details>

  <h2>5. Что это не доказывает</h2>
  <div class="card note">
    <p>Проверка конечна: ${total} сидов, лимит ${results.config.maxTurns} ходов, луч шириной
    ${results.config.beamWidth}. Вывод «проходима» означает «существует найденная выигрышная
    последовательность для перечисленных сидов», а не
    «любой сид гарантированно проходим» и не «человек легко пройдёт игру». Отсутствие решения
    при данном бюджете поиска не равносильно доказательству непроходимости сида.</p>
    <p>Также ИИ не играет в браузере и не меняет саму игру: это отдельный инструмент анализа,
    который запускает тот же код движка из <span class="mono">index.html</span>.</p>
  </div>

  <footer>КРАЙ / Edge Push · <a href="../index.html">открыть игру</a> ·
  <span class="mono">ai/evolve.mjs · ai/evaluate.mjs · ai/report.mjs</span></footer>
</div>

<script>
const D = ${json};
const trace = D.replay.final
  ? D.replay.trace.concat([{ state: D.replay.final, action: { type: 'WIN' } }])
  : D.replay.trace;
const board = document.getElementById('board');
const GL = { UP:'▲', DOWN:'▼', LEFT:'◄', RIGHT:'►' };
const KIND = { STEP:'шаг', PUSH:'толчок', PULL:'крюк', FALL:'сброс в пропасть', VOID:'сброс за край',
  HAZARD:'урон о лаву/шипы', SWAP:'смена мест и оглушение', LAND:'перелёт через героя', WAIT:'щит' };
let i = 0, timer = null, speed = 1;

function actionLabel(a){
  if (a.type === 'WIN') return 'КРАЙ ДОСТИГНУТ! · 7/7 ЭТАЖЕЙ';
  if (a.type === 'PERK') return 'ПЕРК · ' + (D.perkTitles[a.id] || a.id);
  if (a.type === 'WAIT') return '⛨ ЖДАТЬ · щит на один удар';
  const mode = a.mode === 'HOOK' ? 'КРЮК' : a.mode === 'THROW' ? 'БРОСОК' : 'БАЗОВЫЙ ХОД';
  return (GL[a.dir] || '•') + ' ' + mode + ' · ' + (KIND[a.kind] || a.kind || '');
}
function render(){
  const f = trace[i], s = f.state, cells = [];
  const units = new Map();
  for (const e of s.entities) units.set(e.y * 5 + e.x, e);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const k = y * 5 + x, e = units.get(k);
    let u = '';
    if (e) {
      const cls = e.kind === 'PLAYER' ? 'player' : e.kind === 'BARREL' ? 'barrel' : 'enemy ' + e.type;
      const active = s.activeIds.includes(e.id) ? ' active' : '';
      const letter = e.kind === 'PLAYER' ? '◇' : e.kind === 'BARREL' ? '!' :
        ({BRUTE:'Г',CHARGER:'Б',SNIPER:'С',BOMBER:'В',JUGGERNAUT:'Д'}[e.type] || '?');
      const pips = e.kind === 'ENEMY' && e.hp > 1 ? '<span class="pip">' +
        Array.from({length:Math.min(4,e.hp)},()=>'<i></i>').join('') + '</span>' : '';
      u = '<div class="u ' + cls + active + '">' + letter + pips + '</div>';
    }
    cells.push('<div class="cell t-' + s.grid[y][x] + '">' + u + '</div>');
  }
  board.innerHTML = cells.join('');
  document.getElementById('action').textContent = actionLabel(f.action);
  document.getElementById('counter').textContent = 'кадр ' + (i + 1) + ' / ' + trace.length +
    (f.score !== undefined ? '   ·   Q = ' + f.score : '');
  document.getElementById('stats').innerHTML = [
    'ЭТАЖ ' + s.floor + '/7', 'ХОД ' + s.turn, 'HP ' + s.hp + '/' + s.maxHp,
    'УБИТО ' + s.kills, 'В БЕЗДНЕ ' + s.falls, 'ЩИТ ' + s.shield,
    'КРЮК ' + s.hookCd, 'БРОСОК ' + s.throwCd
  ].map(x => '<span class="chip">' + x + '</span>').join('');
  document.getElementById('seek').value = String(i);
}
function set(k){ i = Math.max(0, Math.min(trace.length - 1, k)); render(); }
function stop(){ if(timer) clearInterval(timer); timer = null; document.getElementById('play').textContent='▶ ВОСПРОИЗВЕСТИ'; }
function play(){
  if(timer){ stop(); return; }
  if(i >= trace.length - 1) set(0);
  document.getElementById('play').textContent='❚❚ ПАУЗА';
  timer = setInterval(() => { if(i >= trace.length - 1){ stop(); return; } set(i + 1); }, 420 / speed);
}
document.getElementById('play').onclick = play;
document.getElementById('prev').onclick = () => { stop(); set(i - 1); };
document.getElementById('next').onclick = () => { stop(); set(i + 1); };
document.getElementById('seek').oninput = e => { stop(); set(+e.target.value); };
document.getElementById('speed').onclick = e => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  e.target.textContent = 'СКОРОСТЬ ×' + speed;
  if(timer){ stop(); play(); }
};
render();
</script>
</body>
</html>
`;

writeFileSync(resolve('ai/index.html'), page);
console.log(`Отчёт собран: ai/index.html (${(page.length / 1024).toFixed(0)} КБ)`);
console.log(`Вердикт: ${verdictTitle}; выигрышных сидов ${union}/${total}; реплей ${replay.trace.length} кадров`);
