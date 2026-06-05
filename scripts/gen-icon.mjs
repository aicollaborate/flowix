// Generates two artifacts from app/frontend/assets/logo.svg:
//
//  1. _source.png (transparent background) — fed to `npx tauri icon`
//     to regenerate all platform icons (icon.png, icon.ico, icon.icns,
//     32x32.png, 128x128.png, iOS, Android).
//
//  2. appicon.png (white → soft-indigo gradient with the logo) — written
//     AFTER `tauri icon` runs, to override the macOS-style treatment
//     Tauri CLI applies to the default appicon.png. This file is the
//     Linux desktop icon referenced in tauri.conf.json.
//
// One-off script — safe to delete after running.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const logoSvgPath = resolve(root, 'app/frontend/assets/logo.svg');
const iconsDir = resolve(root, 'app/backend/icons');
const sourcePngPath = resolve(iconsDir, '_source.png');
const appiconPngPath = resolve(iconsDir, 'appicon.png');

const rawSvg = readFileSync(logoSvgPath, 'utf8');
const inner = rawSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

const SIZE = 1024;
const LOGO_SCALE = 0.7;
const LOGO_SIZE = SIZE * LOGO_SCALE;
const LOGO_OFFSET = (SIZE - LOGO_SIZE) / 2;
const scale = (LOGO_SIZE / 138).toFixed(6);

function render(composed) {
  const resvg = new Resvg(composed, {
    fitTo: { mode: 'width', value: SIZE },
    background: 'transparent',
  });
  return resvg.render().asPng();
}

// 1) Transparent-background source for `tauri icon`.
const transparent = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <g transform="translate(${LOGO_OFFSET} ${LOGO_OFFSET}) scale(${scale})">
    ${inner}
  </g>
</svg>`;
writeFileSync(sourcePngPath, render(transparent));
console.log(`✓ ${sourcePngPath}  (${SIZE}x${SIZE}, transparent)`);

// 2) appicon.png with white → soft-indigo gradient + logo.
//    This is what users see on the Linux desktop / Windows Store surfaces.
const gradient = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#DBE3FA"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
  <g transform="translate(${LOGO_OFFSET} ${LOGO_OFFSET}) scale(${scale})">
    ${inner}
  </g>
</svg>`;
writeFileSync(appiconPngPath, render(gradient));
console.log(`✓ ${appiconPngPath}  (${SIZE}x${SIZE}, white→indigo gradient)`);
