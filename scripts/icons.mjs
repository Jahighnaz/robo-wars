// Renders the app icons with headless Chromium. Run: node scripts/icons.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#1a0d2e"/><stop offset="1" stop-color="#05060b"/></radialGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#00f0ff" stroke-opacity=".12" stroke-width="2"/></pattern>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect width="512" height="512" fill="url(#grid)"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)" filter="url(#glow)" fill="#0a0d16" stroke-width="12" stroke-linejoin="round">
    <path d="M196 96h120l-0 0v100H196z" stroke="#ffd166"/>
    <path d="M232 40h48v56h-48z" stroke="#ffd166"/>
    <path d="M96 196h100v120H96z" stroke="#9fb4cc"/>
    <path d="M316 196h100v120H316z" stroke="#9fb4cc"/>
    <path d="M196 316h120v100H196z" stroke="#ff2bd6"/>
    <path d="M256 186L326 226V286L256 326L186 286V226Z" stroke="#f5ff3b" stroke-width="16"/>
    <path d="M256 222L292 243V269L256 290L220 269V243Z" fill="#f5ff3b" stroke="none"/>
  </g>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
const out = [
  ['icon-512.png', 512, 0.06], ['icon-192.png', 192, 0.06], ['apple-touch-icon.png', 180, 0.08], ['icon-maskable-512.png', 512, 0.28],
];
for (const [name, size, pad] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#05060b">${svg(pad).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  writeFileSync(`public/icons/${name}`, await page.screenshot({ type: 'png', omitBackground: false }));
}
await browser.close();
console.log('icons written');
