/** Единый список веб-ассетов для sw.js, manifest.json, APK и dist/.
 *  [источник относительно корня репозитория, путь внутри веб-корня]. */
export const WEB_ASSETS = [
  ['index.html', 'index.html'],
  ['manifest.json', 'manifest.json'],
  ['sw.js', 'sw.js'],
  ['favicon.svg', 'favicon.svg'],
  ['apple-touch-icon.png', 'apple-touch-icon.png'],
  ['icons/icon-192.png', 'icons/icon-192.png'],
  ['icons/icon-512.png', 'icons/icon-512.png'],
  ['icons/icon-maskable-192.png', 'icons/icon-maskable-192.png'],
  ['icons/icon-maskable-512.png', 'icons/icon-maskable-512.png'],
  ['store/screenshots/01-board.png', 'store/screenshots/01-board.png'],
  ['store/screenshots/02-difficulty.png', 'store/screenshots/02-difficulty.png'],
  ['store/screenshots/03-legend.png', 'store/screenshots/03-legend.png'],
  ['store/privacy-policy.html', 'store/privacy-policy.html'],
  ['.well-known/assetlinks.json', '.well-known/assetlinks.json'],
  ['ai/index.html', 'ai/index.html'],
  ['ai/difficulty.json', 'ai/difficulty.json'],
  ['ai/mastery.json', 'ai/mastery.json'],
  ['ai/results.json', 'ai/results.json'],
  ['ai/replay.json', 'ai/replay.json'],
  ['ai/training.json', 'ai/training.json'],
  ['README.md', 'README.md']
];

/** Дополнительные файлы только для статического HTTPS-хостинга. */
export const DIST_EXTRAS = [
  ['store/privacy-policy.html', 'privacy-policy.html'],
  ['.nojekyll', '.nojekyll']
];
