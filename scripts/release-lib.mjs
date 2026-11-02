/** Общие проверки готовности Android-релиза. Используются CLI и node:test. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WEB_ASSETS } from './web-assets.mjs';
import { verify } from './sync-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = p => path.join(ROOT, p);
const read = p => readFileSync(abs(p), 'utf8');
const raw = p => readFileSync(abs(p));
const exists = p => existsSync(abs(p));
const sha = p => createHash('sha256').update(raw(p)).digest('hex');

function pngSize(p) {
  const b = raw(p);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG')
    throw new Error(p + ': не PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function json(p) { return JSON.parse(read(p)); }

function walk(dir, base = '') {
  const out = [];
  for (const ent of readdirSync(abs(dir), { withFileTypes: true })) {
    const rel = base ? base + '/' + ent.name : ent.name;
    if (['.git', 'node_modules', 'dist', 'build', '.gradle', '__pycache__', 'Unselected files'].includes(ent.name)) continue;
    if (ent.name.startsWith('.tmp_')) continue;
    const full = dir + '/' + ent.name;
    if (ent.isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

export function collectChecks() {
  const out = [];
  const add = (name, fn) => {
    try {
      const r = fn();
      if (r === false) out.push({ name, ok: false, detail: 'проверка вернула false' });
      else if (r && typeof r === 'object' && 'ok' in r) out.push({ name, ok: !!r.ok, detail: r.detail || '' });
      else out.push({ name, ok: true, detail: typeof r === 'string' ? r : '' });
    } catch (e) {
      out.push({ name, ok: false, detail: e.message });
    }
  };
  const has = (hay, needle) => ({ ok: hay.includes(needle), detail: needle });
  const re = (hay, pattern, label) => ({ ok: pattern.test(hay), detail: label });

  let pkg, man, sw, idx, html, gradleApp, manifest, main, gitignore, readme, release;
  try {
    pkg = json('package.json');
    man = json('manifest.json');
    sw = read('sw.js');
    idx = read('index.html');
    gradleApp = read('android/app/build.gradle');
    manifest = read('android/app/src/main/AndroidManifest.xml');
    main = read('android/app/src/main/java/com/kubiknubika/edgepush/MainActivity.java');
    gitignore = read('.gitignore');
    readme = read('README.md');
    release = read('RELEASE.md');
  } catch (e) {
    out.push({ name: 'базовые файлы читаются', ok: false, detail: e.message });
    return out;
  }

  const ver = pkg.version;
  add('package.json: версия ' + ver, () => has(ver, /^\d+\.\d+\.\d+$/.test(ver) ? ver : 'НЕВЕРНАЯ', ));
  add('package-lock.json: та же версия', () => has(json('package-lock.json').version, ver));
  add('package.json: сценарии релиза', () => {
    const s = pkg.scripts;
    const need = ['icons', 'store:art', 'store:screenshots', 'android:assets', 'pwa:build', 'release:check', 'version:bump', 'test'];
    const miss = need.filter(k => !s[k]);
    return { ok: miss.length === 0, detail: miss.join(', ') };
  });
  add('package.json: playwright-core для скриншотов', () => has(JSON.stringify(pkg.devDependencies || {}), 'playwright-core'));

  add('manifest.json: обязательные поля', () => {
    const need = ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'orientation', 'theme_color', 'background_color', 'icons'];
    const miss = need.filter(k => !(k in man));
    return { ok: miss.length === 0, detail: miss.join(', ') };
  });
  add('manifest.json: standalone / portrait / ru', () =>
    man.display === 'standalone' && man.orientation === 'portrait' && man.lang === 'ru');
  add('manifest.json: theme_color совпадает с meta', () =>
    has(idx, 'content="' + man.theme_color + '"'));
  add('manifest.json: 192/512 + maskable + SVG', () => {
    const icons = man.icons || [];
    const ok192 = icons.some(i => i.sizes === '192x192' && i.type === 'image/png');
    const ok512 = icons.some(i => i.sizes === '512x512' && i.type === 'image/png');
    const okMask = icons.filter(i => (i.purpose || '').includes('maskable')).length >= 2;
    const okSvg = icons.some(i => i.type === 'image/svg+xml');
    return { ok: ok192 && ok512 && okMask && okSvg, detail: `192=${ok192} 512=${ok512} maskable=${okMask} svg=${okSvg}` };
  });
  add('manifest.json: файлы иконок и размеры', () => {
    const bad = [];
    for (const i of (man.icons || [])) {
      if (i.type !== 'image/png') { if (!exists(i.src.replace(/^\.\//, ''))) bad.push(i.src); continue; }
      const f = i.src.replace(/^\.\//, '');
      if (!exists(f)) { bad.push(f + ' (нет)'); continue; }
      const s = pngSize(f);
      const [w, h] = i.sizes.split('x').map(Number);
      if (s.w !== w || s.h !== h) bad.push(`${f}: ${s.w}x${s.h} != ${i.sizes}`);
    }
    return { ok: bad.length === 0, detail: bad.join('; ') };
  });
  add('manifest.json: 3 скриншота и файлы на месте', () => {
    const shots = man.screenshots || [];
    const bad = [];
    if (shots.length < 3) bad.push('мало: ' + shots.length);
    for (const s of shots) {
      const f = s.src.replace(/^\.\//, '');
      if (!exists(f)) { bad.push(f + ' (нет)'); continue; }
      const p = pngSize(f);
      const [w, h] = s.sizes.split('x').map(Number);
      if (p.w !== w || p.h !== h) bad.push(`${f}: ${p.w}x${p.h} != ${s.sizes}`);
    }
    return { ok: bad.length === 0, detail: bad.join('; ') };
  });

  add('index.html: PWA-ссылки и мета', () =>
    idx.includes('rel="manifest" href="manifest.json"') &&
    idx.includes('rel="icon" href="favicon.svg"') &&
    idx.includes('rel="apple-touch-icon"') &&
    idx.includes('mobile-web-app-capable'));
  add('index.html: safe-area для вырезов', () => has(idx, 'env(safe-area-inset-top)'));
  add('index.html: SW только для web, не для APK', () =>
    idx.includes('serviceWorker.register') &&
    idx.includes("has('native')") &&
    idx.includes("'127.0.0.1'") &&
    idx.includes("proto !== 'https:'"));
  add('index.html: по-прежнему один файл без внешних скриптов', () =>
    !/<script[^>]+src=/i.test(idx) && !/<link[^>]+rel="stylesheet"/i.test(idx) && !/@import/i.test(idx));

  add('sw.js: версия кэша = ' + ver, () => {
    const m = sw.match(/const CACHE_NAME = CACHE_PREFIX \+ '([^']+)'/);
    return { ok: !!m && m[1] === ver, detail: m ? m[1] : 'CACHE_NAME не найден' };
  });
  add('sw.js: skipWaiting / clients.claim / offline fallback', () =>
    sw.includes('skipWaiting') && sw.includes('clients.claim') && sw.includes('FALLBACK_URL'));
  add('sw.js: кэширует все веб-ассеты', () => {
    const paths = [...sw.matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]);
    const miss = WEB_ASSETS.map(a => './' + a[1]).filter(p => !paths.includes(p));
    return { ok: miss.length === 0, detail: miss.join(', ') };
  });
  add('все исходные веб-ассеты существуют', () => {
    const miss = WEB_ASSETS.map(a => a[0]).filter(f => !exists(f));
    return { ok: miss.length === 0, detail: miss.join(', ') };
  });
  add('APK-ассеты синхронизированы с корнем', () => verify('android/app/src/main/assets/www'));

  add('Android: applicationId / namespace', () =>
    gradleApp.includes("applicationId 'com.kubiknubika.edgepush'") &&
    gradleApp.includes("namespace 'com.kubiknubika.edgepush'"));
  add('Android: compileSdk/targetSdk 36, minSdk 26', () =>
    /compileSdk 36\b/.test(gradleApp) && /targetSdk 36\b/.test(gradleApp) && /minSdk 26\b/.test(gradleApp));
  add('Android: versionName = ' + ver + ', versionCode > 0', () => {
    const vn = gradleApp.match(/versionName '([^']+)'/);
    const vc = gradleApp.match(/versionCode (\d+)/);
    return { ok: !!vn && vn[1] === ver && !!vc && Number(vc[1]) > 0, detail: `${vn?.[1]} / ${vc?.[1]}` };
  });
  add('Android: WebViewAssetLoader зависимость', () => has(gradleApp, 'androidx.webkit:webkit'));
  add('Android: buildConfig для BuildConfig.DEBUG', () => has(gradleApp, 'buildConfig true'));
  add('AndroidManifest: INTERNET отсутствует, VIBRATE есть', () =>
    !manifest.includes('android.permission.INTERNET') && manifest.includes('android.permission.VIBRATE'));
  add('AndroidManifest: portrait / exported / no backup / no cleartext', () =>
    manifest.includes('screenOrientation="portrait"') &&
    manifest.includes('exported="true"') &&
    manifest.includes('allowBackup="false"') &&
    manifest.includes('usesCleartextTraffic="false"') &&
    manifest.includes('dataExtractionRules'));
  add('MainActivity: локальный https-origin и ?native=1', () =>
    main.includes('WebViewAssetLoader') &&
    main.includes('/assets/www/index.html?native=1') &&
    main.includes('DEFAULT_DOMAIN'));
  add('MainActivity: localStorage включён, file:// и сеть закрыты', () =>
    main.includes('setDomStorageEnabled(true)') &&
    main.includes('setAllowFileAccess(false)') &&
    main.includes('MIXED_CONTENT_NEVER_ALLOW') &&
    main.includes('shouldOverrideUrlLoading'));
  add('Gradle wrapper: jar / скрипты / 8.13', () => {
    const jar = raw('android/gradle/wrapper/gradle-wrapper.jar');
    const props = read('android/gradle/wrapper/gradle-wrapper.properties');
    const exec = statSync(abs('android/gradlew')).mode & 0o111;
    return {
      ok: jar.slice(0, 4).toString('ascii') === 'PK\u0003\u0004' &&
          exists('android/gradlew.bat') && !!exec && props.includes('gradle-8.13-bin.zip'),
      detail: `jar=${jar.length}B exec=${!!exec}`
    };
  });
  add('Gradle: AGP 8.13.0 и репозитории', () =>
    read('android/build.gradle').includes("version '8.13.0'") &&
    read('android/settings.gradle').includes('google()') &&
    read('android/settings.gradle').includes('mavenCentral()'));
  add('Adaptive icon и векторный foreground', () =>
    exists('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml') &&
    read('android/app/src/main/res/drawable/ic_launcher_foreground.xml').includes('viewportWidth="108"'));
  add('Launcher PNG всех плотностей', () => {
    const want = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    const bad = [];
    for (const [d, s] of Object.entries(want)) {
      const f = `android/app/src/main/res/mipmap-${d}/ic_launcher.png`;
      const p = pngSize(f);
      if (p.w !== s || p.h !== s) bad.push(`${d}:${p.w}x${p.h}`);
    }
    return { ok: bad.length === 0, detail: bad.join(', ') };
  });
  add('apple-touch-icon 180 и favicon.svg', () =>
    pngSize('apple-touch-icon.png').w === 180 && read('favicon.svg').includes('<svg'));
  add('maskable-иконка отличается от обычной', () =>
    sha('icons/icon-512.png') !== sha('icons/icon-maskable-512.png'));

  add('Store: иконка 512 и баннер 1024×500', () => {
    const i = pngSize('store/icon-512.png'), f = pngSize('store/feature-graphic.png');
    return { ok: i.w === 512 && i.h === 512 && f.w === 1024 && f.h === 500, detail: `${i.w}x${i.h} / ${f.w}x${f.h}` };
  });
  add('Store: 3 скриншота ≥320px и соотношение ≤2', () => {
    const bad = [];
    for (const f of ['01-board.png', '02-difficulty.png', '03-legend.png']) {
      const p = pngSize('store/screenshots/' + f);
      if (p.w < 320 || p.h < 480 || p.h / p.w > 2) bad.push(f + ` ${p.w}x${p.h}`);
    }
    return { ok: bad.length === 0, detail: bad.join(', ') };
  });
  add('Store: тексты, политика, data safety, assetlinks, release notes', () => {
    const need = ['listing-ru.md', 'listing-en.md', 'data-safety.md', 'privacy-policy.md',
      'privacy-policy.html', 'assetlinks.json', 'release-notes.md', 'README.md'];
    const miss = need.filter(f => !exists('store/' + f));
    return { ok: miss.length === 0, detail: miss.join(', ') };
  });
  add('Store: политика без внешних CSS/JS и с офлайн-формулировкой', () => {
    const h = read('store/privacy-policy.html');
    return !/<link[^>]+stylesheet/i.test(h) && !/<script[^>]+src=/i.test(h) &&
      h.includes('INTERNET') && h.includes('VIBRATE') && h.includes('localStorage');
  });
  add('Assetlinks: шаблон и корневая копия совпадают и указывают на package', () => {
    const files = ['store/assetlinks.json', '.well-known/assetlinks.json'];
    const bad = [];
    for (const f of files) {
      if (!exists(f)) { bad.push(f + ' (нет)'); continue; }
      const a = json(f);
      const fp = a?.[0]?.target?.sha256_cert_fingerprints?.[0] || '';
      if (a?.[0]?.target?.package_name !== 'com.kubiknubika.edgepush' ||
          !(fp === 'REPLACE_WITH_APP_SIGNING_CERT_SHA256' || /^[0-9A-F]{64}$/i.test(fp)))
        bad.push(f + ' (содержимое)');
    }
    if (files.every(exists) && sha(files[0]) !== sha(files[1])) bad.push('копии различаются');
    return { ok: bad.length === 0, detail: bad.join('; ') };
  });
  add('Store: короткое описание RU ≤80, название ≤30', () => {
    const ru = read('store/listing-ru.md');
    const title = ru.match(/## Название[^\n]*\n\s*`([^`]+)`/)?.[1] || '';
    const short = ru.match(/## Краткое описание[^\n]*\n\s*`([^`]+)`/)?.[1] || '';
    return { ok: title.length > 0 && title.length <= 30 && short.length > 0 && short.length <= 80,
      detail: `title=${title.length} short=${short.length}` };
  });
  add('Store: короткое описание EN ≤80', () => {
    const en = read('store/listing-en.md');
    const short = en.match(/## Short description[^\n]*\n\s*`([^`]+)`/)?.[1] || '';
    return { ok: short.length > 0 && short.length <= 80, detail: 'short=' + short.length };
  });
  add('Store: release notes содержат ' + ver, () => has(read('store/release-notes.md'), ver));

  add('RELEASE.md: чек-лист сборки AAB и APK', () =>
    release.includes('bundleRelease') && release.includes('assembleRelease') &&
    release.includes('keystore.properties') && release.includes('targetSdk 36'));
  add('README.md: раздел Android/PWA', () =>
    readme.includes('## Android') && readme.includes('release:check') && readme.includes('pwa:build'));
  add('Скрипты: bump-version и release-тест', () =>
    exists('scripts/bump-version.mjs') && exists('tests/release.test.mjs'));

  add('.gitignore: секреты и билды не попадают в Git', () => {
    const need = ['android/keystore.properties', '*.jks', '*.keystore', '*.aab', '*.apk', 'dist/', 'android/app/build/', 'android/local.properties'];
    const miss = need.filter(s => !gitignore.includes(s));
    return { ok: miss.length === 0, detail: miss.join(', ') };
  });
  add('keystore.properties.example без реальных паролей', () =>
    read('android/keystore.properties.example').includes('CHANGE_ME') && !exists('android/keystore.properties'));
  add('В Git нет keystore / APK / AAB / dist', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0').filter(Boolean);
    const bad = files.filter(f => /(\.jks$|\.keystore$|\.aab$|\.apk$|^dist\/|android\/keystore\.properties$|android\/local\.properties$)/.test(f));
    return { ok: bad.length === 0, detail: bad.join(', ') };
  });

  add('Исходники без CJK/иероглифов', () => {
    const textFiles = walk('.').filter(f => /\.(md|html|json|js|mjs|java|xml|gradle|properties|svg|sh|css|txt)$/.test(f));
    const bad = textFiles.filter(f => /[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(read(f)));
    return { ok: bad.length === 0, detail: bad.join(', ') };
  });
  add('Исходники без смешанных кириллица/латиница в одном слове', () => {
    const textFiles = walk('.').filter(f => /\.(md|html|json|js|mjs|java|xml|gradle|properties|svg|sh|css|txt)$/.test(f));
    const bad = textFiles.filter(f =>
      /[А-Яа-яЁё][A-Za-z]|[A-Za-z][А-Яа-яЁё]/.test(read(f).replace(/\\n|\\t|\\r/g, '')));
    return { ok: bad.length === 0, detail: bad.join(', ') };
  });
  add('Нет забытых TODO/FIXME/assigns', () => {
    const textFiles = walk('.').filter(f =>
      /\.(md|html|json|js|mjs|java|xml|gradle|properties|svg|sh|css|txt)$/.test(f) &&
      f !== 'scripts/release-lib.mjs');   // сам чекер содержит список запрещённых слов
    const bad = textFiles.filter(f => /\b(TODO|FIXME|assigns)\b/.test(read(f)));
    return { ok: bad.length === 0, detail: bad.join(', ') };
  });

  return out;
}
