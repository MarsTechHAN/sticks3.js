// Headless logic checks for the core API (no DOM / WebGL needed).
//   node scripts/check.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  Device, Module, Button, Display, Port, Imu, createBridge,
  definePlugin, registerPlugin, createDevice, listModules,
} from '../src/core/index.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; }
};

class Board extends Device {
  static meta = { id: 'test.board', name: 'Board', keymap: { Space: 'a' } };
  build() {
    this.add(new Display({ id: 'lcd', width: 4, height: 3, size: [4, 3], glass: false }));
    this.add(new Button({ id: 'a', mesh: new THREE.Mesh(new THREE.BoxGeometry()) }));
    this.add(new Port({ id: 'ext', connector: 'test.bus' }));
    this.add(new Imu({ id: 'imu', axes: { x: '-y', y: '+x', z: '+z' } }));
  }
}
class Widget extends Module {
  static meta = { id: 'test.widget', name: 'Widget', connector: 'test.bus' };
  build() { this.add(new Button({ id: 'k' })); }
}
class Wrong extends Module {
  static meta = { id: 'test.wrong', name: 'Wrong', connector: 'other' };
}
registerPlugin(definePlugin({ name: 'test', devices: [Board], modules: [Widget, Wrong] }));

console.log('core');

test('registry creates devices and filters modules by connector', () => {
  assert.ok(createDevice('test.board') instanceof Board);
  assert.deepEqual(listModules({ connector: 'test.bus' }).map((m) => m.id), ['test.widget']);
});

test('typed accessors and kind checks', () => {
  const d = new Board();
  assert.equal(d.display('lcd').width, 4);
  assert.throws(() => d.display('a'), /is a button/);
  assert.throws(() => d.get('nope'), /No component/);
});

test('RGB565 write expands to 8-bit, honours rect and byte swap', () => {
  const lcd = new Board().display('lcd');
  lcd.writeRGB565(new Uint16Array([0xf800, 0x07e0, 0x001f, 0xffff]), { x: 0, y: 1, w: 4, h: 1 });
  assert.deepEqual(lcd.getPixel(0, 1), [255, 0, 0]);
  assert.deepEqual(lcd.getPixel(1, 1), [0, 255, 0]);
  assert.deepEqual(lcd.getPixel(2, 1), [0, 0, 255]);
  assert.deepEqual(lcd.getPixel(3, 1), [255, 255, 255]);
  assert.deepEqual(lcd.getPixel(0, 0), [0, 0, 0]);
  lcd.writeRGB565(new Uint16Array([0x00f8]), { x: 3, y: 2, w: 1, h: 1 }, { swapBytes: true });
  assert.deepEqual(lcd.getPixel(3, 2), [255, 0, 0]);
});

test('display command routing (rgb888, fill, backlight)', () => {
  const d = new Board();
  d.handle({ type: 'display', target: 'lcd', format: 'rgb888', x: 1, y: 0, w: 1, h: 1, data: new Uint8Array([1, 2, 3]) });
  assert.deepEqual(d.display().getPixel(1, 0), [1, 2, 3]);
  d.handle([{ type: 'display', target: 'lcd', fill: '#ff0000' }, { type: 'display', target: 'lcd', backlight: 0.5 }]);
  assert.deepEqual(d.display().getPixel(2, 2), [255, 0, 0]);
  assert.equal(d.display().getState().backlight, 0.5);
});

test('button: multi-source press, down/up/click events bubble as input', () => {
  const d = new Board();
  const seen = [];
  d.on('input', (e) => seen.push(`${e.id}:${e.action}`));
  const b = d.button('a');
  b.press('pointer:1');
  b.press('key:Space');
  b.release('pointer:1');
  assert.equal(b.pressed, true, 'still held by keyboard');
  b.release('key:Space');
  assert.deepEqual(seen, ['a:down', 'a:up', 'a:click']);
});

test('ports: connector check, attach/detach, path routing into modules', () => {
  const d = new Board();
  const seen = [];
  d.on('input', (e) => seen.push(`${e.id}:${e.action}`));
  assert.throws(() => d.port('ext').attach('test.wrong'), /does not fit/);
  d.port('ext').attach('test.widget');
  assert.equal(d.get('ext/k').path, 'ext/k');
  d.handle({ type: 'button', target: 'ext/k', action: 'press' });
  assert.equal(d.button('ext/k').pressed, true);
  assert.equal(d.list('button').length, 2);
  d.handle({ type: 'detach', target: 'ext' });
  assert.throws(() => d.get('ext/k'), /Nothing attached/);
  assert.deepEqual(seen, ['ext:attach', 'ext/k:down', 'ext:detach']);
});

test('bridge: inputs out, commands in, replies with id', () => {
  const d = new Board();
  const out = [];
  const bridge = createBridge(d, { send: (m) => out.push(m) });
  d.button('a').press();
  bridge.receive({ type: 'imu', target: 'imu', id: 7 });
  bridge.receive({ type: 'bogus', target: 'missing', id: 8 });
  assert.equal(out[0].type, 'input');
  assert.equal(out[0].id, 'a');
  assert.equal(out[1].type, 'reply');
  assert.equal(out[1].id, 7);
  assert.equal(out[1].result.accel.x, -1, 'upright device: sensor X (toward USB) reads -1 g');
  assert.match(out[2].error, /No component/);
  bridge.dispose();
});

test('IMU follows device orientation (screen up → +Z = 1 g)', () => {
  const d = new Board();
  d.root.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  d.root.updateMatrixWorld(true);
  const { accel } = d.imu().read();
  assert.ok(Math.abs(accel.z - 1) < 1e-3, JSON.stringify(accel));
});

test('vibration pattern runs and ends', () => {
  const d = new Board();
  d.vibrate([50, 30, 50]);
  assert.equal(d.vibrating, true);
  for (let i = 0; i < 20; i++) d.update(0.01, i * 0.01);
  assert.equal(d.vibrating, false);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
