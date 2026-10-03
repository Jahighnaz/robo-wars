// Renders the app icons (Charles on a neon grid) with headless Chromium.
// Run: node scripts/icons.mjs   (needs playwright)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const portrait = 'data:image/png;base64,' + readFileSync('public/charles/portrait.png').toString('base64');
const html = (size, pad) => `<html><body style="margin:0">
<div style="width:${size}px;height:${size}px;position:relative;overflow:hidden;
  background:radial-gradient(circle at 50% 38%, #3a0f52 0%, #12081f 55%, #05060b 100%);">
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(0,240,255,.16) 2px,transparent 2px),linear-gradient(90deg,rgba(0,240,255,.16) 2px,transparent 2px);background-size:${size / 12}px ${size / 12}px"></div>
  <div style="position:absolute;left:0;right:0;bottom:${size * 0.08}px;height:${size * 0.04}px;background:#ff2bd6;box-shadow:0 0 ${size * 0.06}px #ff2bd6"></div>
  <img src="${portrait}" style="position:absolute;left:50%;bottom:${size * 0.1}px;height:${size * (1 - pad) * 0.86}px;transform:translateX(-50%);
    image-rendering:pixelated;filter:drop-shadow(0 0 ${size * 0.03}px rgba(0,240,255,.8))">
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-512.png', 512, 0.05], ['icon-192.png', 192, 0.05], ['apple-touch-icon.png', 180, 0.05], ['icon-maskable-512.png', 512, 0.3]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size, pad));
  await page.waitForTimeout(100);
  writeFileSync(`public/icons/${name}`, await page.screenshot({ type: 'png' }));
}
await browser.close();
console.log('icons written');
