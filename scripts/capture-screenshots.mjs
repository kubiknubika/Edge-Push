#!/usr/bin/env node
/**
 * Скриншоты для Google Play / richer install UI.
 *
 *   npm start                              # в другом терминале
 *   CHROMIUM_PATH=/tmp/chromium LD_LIBRARY_PATH=/tmp/al2023lib/lib npm run store:screenshots
 *
 * BASE_URL можно переопределить. Нужен playwright-core и локальный Chrome/Chromium;
 * нативный APK бинарник браузера не содержит.
 */
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store', 'screenshots');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8000/';
const EXECUTABLE = process.env.CHROMIUM_PATH || process.env.CHROME_PATH || '/tmp/chromium';

if (!existsSync(EXECUTABLE)) {
  console.error('Не найден Chrome/Chromium. Задайте CHROMIUM_PATH=/путь/к/chrome');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const context = await browser.newContext({
  viewport: { width: 390, height: 780 }, // ровно 2:1 — лимит Play для телефонных скриншотов
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  serviceWorkers: 'block'
});
await context.addInitScript(() => {
  try { localStorage.setItem('edge-push:tutorial:v1', 'done'); } catch (e) {}
});

const errors = [];
const page = await context.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(BASE_URL, { waitUntil: 'load' });
await page.waitForSelector('#app');
await page.addStyleTag({ content: '#toast{display:none!important}' });
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(OUT, '01-board.png') });

await page.keyboard.press('c');                 // переключатель сложности
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, '02-difficulty.png') });

await page.keyboard.press('Escape');
await page.keyboard.press('l');                 // легенда «кто есть кто»
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, '03-legend.png') });

await browser.close();

if (errors.length) {
  console.error('Ошибки страницы:', errors);
  process.exit(1);
}
for (const f of ['01-board.png', '02-difficulty.png', '03-legend.png'])
  console.log('store/screenshots/' + f);
