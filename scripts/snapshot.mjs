// Visual smoke test: loads the demo in headless Chromium (WebGL via SwiftShader),
// runs optional scripted steps and writes screenshots + console errors.
//
//   node scripts/snapshot.mjs [url] [outDir]
//
// Requires the dev server (`npm run dev`) and Google Chrome (or `npx playwright install chromium` + CHANNEL=).
import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'snapshots';
fs.mkdirSync(out, { recursive: true });

// Uses installed Google Chrome by default (CHANNEL= to use Playwright's bundled Chromium).
const channel = process.env.CHANNEL ?? 'chrome';
const browser = await chromium.launch({
  channel: channel || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(url);
await page.waitForTimeout(4000);

const shot = async (name) => page.screenshot({ path: `${out}/${name}.png` });
const run = (fn, arg) => page.evaluate(fn, arg);

await shot('01-front');
for (const view of ['iso', 'back', 'top', 'bottom', 'left', 'right']) {
  await run((v) => window.viewer.setView(v, { duration: 0 }), view);
  await page.waitForTimeout(900);
  await shot(`02-${view}`);
}

// Modules + inspect
await run(() => { window.device.port('hat').attach('example.hat.led-matrix-8x8'); window.device.port('grove').attach('example.grove.button-unit'); window.device.port('usb').attach('example.usb-c-cable'); window.viewer.fit(); window.viewer.setView('iso', { duration: 0 }); });
await page.waitForTimeout(800);
await shot('03-modules');
await run(() => window.viewer.setView('iso-back', { duration: 0 }));
await page.waitForTimeout(900);
await shot('03b-modules-back');
await run(() => { window.viewer.setView('front', { duration: 0 }); window.viewer.focus('lcd', { distance: 60, duration: 0 }); });
await page.waitForTimeout(500);
await shot('04-inspect');
await run(() => window.viewer.focus('lcd', { distance: 22, duration: 0 }));
await page.waitForTimeout(700);
await shot('05-subpixels');

// ── Interaction checks through the real pointer / keyboard paths ──
await run(() => {
  window.device.port('hat').detach();
  window.device.port('grove').detach();
  window.device.port('usb').detach();
  window.viewer.resetView({ duration: 0 });
  window.__events = [];
  window.device.on('input', (e) => window.__events.push(`${e.id}:${e.action}`));
});
await page.waitForTimeout(900);
const screenOf = (path) => run((p) => {
  const THREE_V = window.device.get(p).object3d.getWorldPosition(window.viewer.camera.position.clone());
  THREE_V.project(window.viewer.camera);
  const r = window.viewer.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (THREE_V.x + 1) / 2 * r.width, y: r.top + (1 - THREE_V.y) / 2 * r.height };
}, path);

const a = await screenOf('btnA');
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.waitForTimeout(150);
await shot('06-btnA-pressed');
await page.mouse.up();
await page.keyboard.down('KeyB');
await page.waitForTimeout(80);
await page.keyboard.up('KeyB');

await run(() => window.device.display('lcd').setTouchEnabled(true));
const l = await screenOf('lcd');
await page.mouse.move(l.x - 20, l.y);
await page.mouse.down();
for (let i = 1; i <= 5; i++) await page.mouse.move(l.x - 20 + i * 8, l.y + i * 10);
await page.mouse.up();

// Drag on the body (below the key) rotates the device; IMU must follow.
const before = await run(() => window.device.imu().read().accel);
await page.mouse.move(a.x + 60, a.y + 60);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + 60 + i * 15, a.y + 60 - i * 6);
await page.mouse.up();
await page.waitForTimeout(600);
const after = await run(() => window.device.imu().read().accel);
await shot('07-after-drag');

await run(() => window.device.vibrate(1500));
await page.waitForTimeout(200);
const vib = await run(() => window.device.vibrating);

const events = await run(() => window.__events);
const report = { events, imuBefore: before, imuAfter: after, vibrating: vib };
console.log(JSON.stringify(report, null, 1));
const state = await run(() => window.device.getState());
fs.writeFileSync(`${out}/state.json`, JSON.stringify({ report, state }, null, 2));

fs.writeFileSync(`${out}/console.txt`, errors.join('\n'));
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
