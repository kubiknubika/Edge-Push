#!/usr/bin/env node
/**
 * КРАЙ / Edge Push — генератор значков без внешних зависимостей.
 *
 * Рисует один и тот же знак в двух кадрировках:
 *   regular  — для PWA / Play Store / обычного лаунчера;
 *   maskable — всё важное внутри центрального круга Ø80% (безопасная зона Android).
 *
 * master 1024×1024 →area-average downsample → 192/512/180/48…192 px.
 * palette: тёмный фон, cyan=свой, red=чужой, orange=опасная местность.
 *
 *   node scripts/generate-icons.mjs   (или npm run icons)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = 1024;
const out = p => path.join(ROOT, p);
const clamp01 = v => Math.max(0, Math.min(1, v));

/* ---------- минимальный PNG-энкодер (RGBA, filter 0) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function writePng(file, w, h, rgba) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, encodePng(w, h, rgba));
}

/* ---------- растровые примитивы ---------- */
function blend(p, i, r, g, b, a) {
  if (a <= 0) return;
  a = Math.min(1, a);
  const ia = 1 - a;
  p[i]     = p[i]     * ia + r * a;
  p[i + 1] = p[i + 1] * ia + g * a;
  p[i + 2] = p[i + 2] * ia + b * a;
  p[i + 3] = 255;
}
function rrSdf(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function fillRR(p, cx, cy, hw, hh, r, c, alpha) {
  const x0 = Math.max(0, Math.floor(cx - hw - 2)), x1 = Math.min(S - 1, Math.ceil(cx + hw + 2));
  const y0 = Math.max(0, Math.floor(cy - hh - 2)), y1 = Math.min(S - 1, Math.ceil(cy + hh + 2));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cov = clamp01(0.5 - rrSdf(x + 0.5, y + 0.5, cx, cy, hw, hh, r));
    blend(p, (y * S + x) * 4, c[0], c[1], c[2], cov * alpha);
  }
}
function strokeRR(p, cx, cy, hw, hh, r, w, c, alpha) {
  const x0 = Math.max(0, Math.floor(cx - hw - w - 2)), x1 = Math.min(S - 1, Math.ceil(cx + hw + w + 2));
  const y0 = Math.max(0, Math.floor(cy - hh - w - 2)), y1 = Math.min(S - 1, Math.ceil(cy + hh + w + 2));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = rrSdf(x + 0.5, y + 0.5, cx, cy, hw, hh, r);
    const cov = clamp01(w / 2 + 0.5 - Math.abs(d));
    blend(p, (y * S + x) * 4, c[0], c[1], c[2], cov * alpha);
  }
}
function strokeSegment(p, x0, y0, x1, y1, w, c, alpha) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - w - 2));
  const maxX = Math.min(S - 1, Math.ceil(Math.max(x0, x1) + w + 2));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - w - 2));
  const maxY = Math.min(S - 1, Math.ceil(Math.max(y0, y1) + w + 2));
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const t = len2 ? Math.max(0, Math.min(1, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / len2)) : 0;
    const dist = Math.hypot(x + 0.5 - (x0 + t * dx), y + 0.5 - (y0 + t * dy));
    const cov = clamp01(w / 2 + 0.5 - dist);
    blend(p, (y * S + x) * 4, c[0], c[1], c[2], cov * alpha);
  }
}
function fillDiamond(p, cx, cy, rx, ry, c, alpha) {
  const x0 = Math.max(0, Math.floor(cx - rx - 2)), x1 = Math.min(S - 1, Math.ceil(cx + rx + 2));
  const y0 = Math.max(0, Math.floor(cy - ry - 2)), y1 = Math.min(S - 1, Math.ceil(cy + ry + 2));
  const m = Math.min(rx, ry);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = (Math.abs(x + 0.5 - cx) / rx + Math.abs(y + 0.5 - cy) / ry - 1) * m;
    const cov = clamp01(0.5 - d);
    blend(p, (y * S + x) * 4, c[0], c[1], c[2], cov * alpha);
  }
}
function fillTriangle(p, pts, c, alpha) {
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - 2)), x1 = Math.min(S - 1, Math.ceil(Math.max(...xs) + 2));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - 2)), y1 = Math.min(S - 1, Math.ceil(Math.max(...ys) + 2));
  const edges = [];
  for (let k = 0; k < 3; k++) {
    const a = pts[k], b = pts[(k + 1) % 3];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    edges.push({ a, ex, ey, len: Math.hypot(ex, ey) });
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let minD = Infinity;
    for (const e of edges) {
      const d = (e.ex * (y + 0.5 - e.a[1]) - e.ey * (x + 0.5 - e.a[0])) / e.len;
      if (d < minD) minD = d;
    }
    const cov = clamp01(0.5 + minD);
    blend(p, (y * S + x) * 4, c[0], c[1], c[2], cov * alpha);
  }
}

/* ---------- сам знак ---------- */
const BG_CENTER = [20, 28, 46], BG_EDGE = [7, 9, 16];
const CYAN = [0, 229, 255], RED = [255, 71, 87], AMBER = [255, 176, 55];
const HAZARD = [255, 122, 26], SLATE = [58, 67, 89], INK = [232, 237, 247];

function drawIcon(scale) {
  const p = new Uint8ClampedArray(S * S * 4);
  const tp = u => (0.5 + (u - 0.5) * scale) * S;   // design coord → pixel
  const ts = v => v * scale * S;                     // design length → pixel
  const inv = n => 0.5 + (n - 0.5) / scale;          // pixel → design coord

  /* фон: радиальный градиент + три защищённых свечения */
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nx = (x + 0.5) / S, ny = (y + 0.5) / S;
    const ux = inv(nx), uy = inv(ny);
    const t = clamp01(Math.hypot(nx - 0.5, ny - 0.5) / 0.70710678);
    let r = BG_CENTER[0] + (BG_EDGE[0] - BG_CENTER[0]) * t;
    let g = BG_CENTER[1] + (BG_EDGE[1] - BG_CENTER[1]) * t;
    let b = BG_CENTER[2] + (BG_EDGE[2] - BG_CENTER[2]) * t;
    const gh = Math.exp(-((ux - 0.34) ** 2 + (uy - 0.5) ** 2) / 0.012);
    const ge = Math.exp(-((ux - 0.62) ** 2 + (uy - 0.5) ** 2) / 0.010);
    const gz = Math.exp(-((ux - 0.77) ** 2 + (uy - 0.5) ** 2) / 0.010);
    r += 34 * ge + 38 * gz;
    g += 46 * gh + 20 * gz;
    b += 58 * gh + 8 * ge;
    const i = (y * S + x) * 4;
    p[i] = r; p[i + 1] = g; p[i + 2] = b; p[i + 3] = 255;
  }

  /* рамка поля 5×5 */
  strokeRR(p, tp(0.5), tp(0.5), ts(0.32), ts(0.32), ts(0.055), ts(0.010), CYAN, 0.28);
  for (let k = 0; k <= 5; k++) {
    const u = 0.18 + k * 0.128;
    strokeSegment(p, tp(u), tp(0.18), tp(u), tp(0.82), ts(0.0045), SLATE, 0.55);
    strokeSegment(p, tp(0.18), tp(u), tp(0.82), tp(u), ts(0.0045), SLATE, 0.55);
  }
  /* «край» — опасная кромка справа */
  strokeSegment(p, tp(0.845), tp(0.20), tp(0.845), tp(0.80), ts(0.009), HAZARD, 0.38);

  /* герой → толчок → враг → кромка */
  fillRR(p, tp(0.34), tp(0.50), ts(0.065), ts(0.065), ts(0.018), CYAN, 1);
  fillRR(p, tp(0.34), tp(0.50), ts(0.026), ts(0.026), ts(0.008), INK, 0.92);
  strokeSegment(p, tp(0.425), tp(0.50), tp(0.525), tp(0.50), ts(0.019), CYAN, 1);
  strokeSegment(p, tp(0.500), tp(0.475), tp(0.535), tp(0.50), ts(0.017), CYAN, 1);
  strokeSegment(p, tp(0.500), tp(0.525), tp(0.535), tp(0.50), ts(0.017), CYAN, 1);
  fillDiamond(p, tp(0.62), tp(0.50), ts(0.075), ts(0.075), RED, 1);
  fillDiamond(p, tp(0.62), tp(0.50), ts(0.026), ts(0.026), INK, 0.85);
  fillTriangle(p, [
    [tp(0.725), tp(0.425)], [tp(0.815), tp(0.50)], [tp(0.725), tp(0.575)]
  ], HAZARD, 1);
  strokeSegment(p, tp(0.745), tp(0.50), tp(0.795), tp(0.50), ts(0.012), AMBER, 0.95);
  return p;
}

/* ---------- area-average downsample ---------- */
function downsample(src, from, to) {
  const dst = new Uint8ClampedArray(to * to * 4);
  const ratio = from / to;
  for (let y = 0; y < to; y++) {
    const y0 = y * ratio, y1 = (y + 1) * ratio;
    for (let x = 0; x < to; x++) {
      const x0 = x * ratio, x1 = (x + 1) * ratio;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        if (sy < 0 || sy >= from) continue;
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          if (sx < 0 || sx >= from) continue;
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const w = wx * wy, i = (sy * from + sx) * 4;
          r += src[i] * w; g += src[i + 1] * w; b += src[i + 2] * w; a += src[i + 3] * w;
          wsum += w;
        }
      }
      const i = (y * to + x) * 4;
      dst[i] = r / wsum; dst[i + 1] = g / wsum; dst[i + 2] = b / wsum; dst[i + 3] = a / wsum;
    }
  }
  return dst;
}

/* ---------- favicon (вектор, без внешних файлов) ---------- */
const FAVICON = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="КРАЙ">
  <defs><radialGradient id="bg" cx="50%" cy="42%" r="72%">
    <stop offset="0" stop-color="#141c2e"/><stop offset="1" stop-color="#070910"/>
  </radialGradient></defs>
  <rect width="64" height="64" rx="12" fill="url(#bg)"/>
  <g stroke="#3a4359" stroke-width=".7" opacity=".65">
    <path d="M11 11H53M11 21.4H53M11 31.8H53M11 42.2H53M11 52.6H53M11 53H53"/>
    <path d="M11 11V53M21.4 11V53M31.8 11V53M42.2 11V53M52.6 11V53"/>
  </g>
  <rect x="12" y="12" width="40" height="40" rx="7" fill="none" stroke="#00e5ff" stroke-width="1.2" opacity=".4"/>
  <rect x="17" y="25" width="13" height="13" rx="3" fill="#00e5ff"/>
  <rect x="21" y="29" width="5" height="5" rx="1.5" fill="#e8edf7"/>
  <path d="M31 31.5H36M34 29L36.5 31.5 34 34" fill="none" stroke="#00e5ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M42 24.5L49 31.5 42 38.5 35 31.5Z" fill="#ff4757"/>
  <path d="M42 29L44.8 31.5 42 34 39.2 31.5Z" fill="#e8edf7" opacity=".85"/>
  <path d="M49 26L55 31.5 49 37Z" fill="#ff7a1a"/>
  <path d="M50.5 31.5H53.5" stroke="#ffb037" stroke-width="1.6" stroke-linecap="round"/>
</svg>
`;

/* ---------- запись ---------- */
const regular = drawIcon(0.92);   // полная кадрировка
const maskable = drawIcon(0.78);  // всё важное в круге Ø80%

const save = (master, file, size) => writePng(out(file), size, size, downsample(master, S, size));

save(regular, 'icons/icon-192.png', 192);
save(regular, 'icons/icon-512.png', 512);
save(maskable, 'icons/icon-maskable-192.png', 192);
save(maskable, 'icons/icon-maskable-512.png', 512);
save(regular, 'apple-touch-icon.png', 180);
save(regular, 'store/icon-512.png', 512);

const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, size] of Object.entries(densities))
  writePng(out(`android/app/src/main/res/mipmap-${d}/ic_launcher.png`), size, size, downsample(regular, S, size));

mkdirSync(out('.'), { recursive: true });
writeFileSync(out('favicon.svg'), FAVICON, 'utf8');

console.log('Иконки: 192/512 + maskable 192/512 + apple-touch 180 + Play 512 + launcher 48/72/96/144/192 + favicon.svg');
