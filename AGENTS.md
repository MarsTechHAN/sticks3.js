# AGENTS.md — using sticks3.js

sticks3.js is the **interactive 3D front-end** for a hardware simulator. The
simulator owns behaviour (firmware, peripherals, timing); sticks3.js owns what
the user sees and touches: a realistic 3D device that can be rotated, whose
buttons can be pressed, whose display shows the simulator's framebuffer, and
whose expansion ports accept plug-in modules.

It is a plain ES-module library on top of `three` (peer dependency, ≥ 0.160,
developed against 0.186). No build step is required to consume it.

```
src/core/            engine: Device, Module, Component, DeviceViewer, bridge, registry
src/core/components/ Button · Display · Led · Speaker · Imu · Port
src/devices/sticks3/ M5Stack StickS3 model (the first device plugin)
src/modules/         example modules: Hat LED matrix, Grove button unit, USB-C cable
demo/                demo page + toy firmware running in a Web Worker
scripts/             check.mjs (logic tests) · snapshot.mjs (visual/interaction smoke test)
reference/           product photos used for modelling
BUILD.md             how the model was built, gotchas, checklist for new products
```

## Commands

```bash
npm install
npm run dev            # demo at http://localhost:5173
npm run check          # headless logic tests (Node, no browser)
node scripts/snapshot.mjs http://localhost:5173/ snapshots   # screenshots + interaction checks (needs Chrome)
npm run build:demo     # static demo build → dist-demo/
```

## Quick start

```js
import { DeviceViewer, StickS3, createBridge } from 'sticks3.js';

const viewer = new DeviceViewer(document.getElementById('stage'));   // any sized element
const device = viewer.mount(new StickS3());

device.on('input', (e) => console.log(e));          // buttons, touch, port plug/unplug
device.display('lcd').writeRGB565(frame, { x: 0, y: 0, w: 135, h: 240 });
device.vibrate([80, 40, 80]);
```

Everything is in **millimetres** (1 scene unit = 1 mm), so displays and ports
are true to size.

## Two channels, nothing else

The simulator and the 3D device talk through exactly two channels, both made of
plain structured-clone-friendly objects (so they work across a Worker,
iframe, WebSocket or WASM boundary unchanged):

| direction | API | payload |
|---|---|---|
| device → simulator | `device.on('input', fn)` | `{ kind, id, action, time, …}` |
| simulator → device | `device.handle(cmd)` (or an array of cmds) | `{ type, target, … }` |

`createBridge(device, { send, imuRate })` wires both for you:

```js
const worker = new Worker('./firmware.js', { type: 'module' });
const bridge = createBridge(device, { send: (m) => worker.postMessage(m), imuRate: 30 });
worker.onmessage = (e) => bridge.receive(e.data);
// worker receives {type:'input',…}, {type:'imu', accel, gyro}; it sends commands.
// A command with an `id` gets {type:'reply', id, result|error} back.
```

See `demo/firmware.worker.js` for a complete simulator-side example.

### Addressing

Components have ids (`lcd`, `btnA`, `hat`). Components of a plugged-in module
are addressed **through the port**: `hat/matrix`, `grove/btn`. The same path is
used in `device.get(path)`, in command `target`s and in input event `id`s.

Typed accessors: `device.display(id)`, `button(id)`, `port(id)`, `led(id)`,
`speaker(id)`, `imu(id)`; `device.list(kind)` enumerates (including modules);
`device.find(path)` is the non-throwing `get`.

### Input events (device → simulator)

| kind | actions | extra fields |
|---|---|---|
| `button` | `down`, `up`, `click`, `longpress` | `source` (`pointer:N`, `key:Code`, `sim`), `duration` on up/click |
| `display` (touch) | `start`, `move`, `end` | `x`, `y` (panel pixels, 0,0 top-left), `pointerId`, `points` (all active touches) |
| `port` | `attach`, `detach` | `module` (module id), `name` |

A button is held while *any* source holds it (mouse + keyboard can overlap).
`click` fires on release if held shorter than `longPressMs` (default 800 ms).

### Commands (simulator → device)

| type | target | fields |
|---|---|---|
| `display` | display path | `format: 'rgb565'│'rgba'│'rgb888'`, `x,y,w,h`, `data` (TypedArray/ArrayBuffer), `swapBytes` · or `fill`, `backlight` (0–1), `power`, `style` (`lcd`/`oled`/`led`/`flat`), `pixelEffect`, `touch` |
| `led` | led path | `color`, `on`, `brightness` |
| `tone` | speaker | `frequency`, `duration` (ms), `volume`, `wave` |
| `pcm` | speaker | `data` (Int16Array/Float32Array), `sampleRate` |
| `vibrate` | — (device) | `pattern` (ms or `[on, off, on…]`), `intensity`, `stop` |
| `imu` | imu path | → returns `{ accel:{x,y,z} g, gyro:{x,y,z} °/s }` |
| `button` | button path | `action: 'press'│'release'│'click'` (drive the UI from the sim) |
| `attach` / `detach` | port path | `module` (registered id), `options` |

RGB565 is the panel-native format; `swapBytes: true` if your framebuffer is
big-endian (as SPI DMA buffers on ESP32 usually are).

## StickS3 reference

| id | kind | notes |
|---|---|---|
| `lcd` | display | 135×240 ST7789P3, 14.86 × 26.42 mm, portrait, (0,0) top-left as seen from the front. Landscape firmware (`setRotation(1)`) must rotate its own buffer. |
| `btnA` | button | KEY1, blue front key, G11. Keys: Space / Enter / A |
| `btnB` | button | KEY2, right side, G12. Keys: B / → |
| `btnPWR` | button | left side, via M5PM1 (`longPressMs` 2000). Key: P |
| `irTx` | led | IR LED G46, drawn as a phone camera sees IR |
| `speaker` | speaker | WebAudio; unlocked on first user click |
| `imu` | imu | BMI270; X → USB end, Y → right side, Z → out of screen |
| `hat` | port `m5.hat2` | 2×8 header on top end; hover reports pin names |
| `grove` | port `grove` | HY2.0-4P bottom end (GND 5V G9 G10) |
| `usb` | port `usb-c` | bottom end; plugging a cable = VBUS present |

Options: `new StickS3({ touch, pixelEffect, caseColor, keyColor, keymap })`.
`touch: true` adds a touch layer to the LCD (the real StickS3 has none — use it
to prototype touch firmware, or as the template for touch devices).

## Viewer

```js
const viewer = new DeviceViewer(el, { background: null, shadows: true, keyboard: true, fov: 26 });
viewer.mount(device) / unmount(device)
viewer.setView('front'|'back'|'left'|'right'|'top'|'bottom'|'iso'|'iso-back' | quaternion, { duration })
viewer.focus('lcd', { distance: 60 })      // zoom to a component (pixel inspection)
viewer.resetView(); viewer.fit(); viewer.zoomTo(mm); viewer.screenshot()
viewer.on('hover', info|null)   // { component, kind, path, label, meta, pixel?, pin? }
viewer.on('select', info)       // click without drag on any part (e.g. a port)
viewer.dispose()
```

Interaction: drag = rotate the **device** (so its IMU sees the motion), wheel /
pinch = zoom, right- or shift-drag = pan, double-click on empty space = reset.
Pointer on an interactive component (button, touch display) operates it
instead. Rendering is on demand — an idle scene costs nothing.

## Plugging modules

```js
import { registerPlugin, examplesPlugin, listModules } from 'sticks3.js';
registerPlugin(examplesPlugin);
device.port('hat').attach('example.hat.led-matrix-8x8');   // by id, class, or instance
device.port('grove').attach(GroveButtonUnit, { cableLength: 18 });
device.port('usb').attach('example.usb-c-cable');
listModules({ connector: device.port('hat').connector });  // what fits
device.port('hat').detach();
```

A port only accepts modules whose `meta.connector` matches its `connector`.

## Adding a device

```js
import * as THREE from 'three';
import { Device, Display, Button, Port, geometry, materials, definePlugin, registerPlugin } from 'sticks3.js/core';

export class MyBoard extends Device {
  static meta = { id: 'acme.board', name: 'ACME Board', size: [54, 54, 16], keymap: { Space: 'btnA' } };

  build({ touch = true } = {}) {                 // called lazily, once
    this.body.add(new THREE.Mesh(geometry.roundedSlab({ w: 54, h: 54, depth: 16, radius: 6, bevel: 1 }),
                                 materials.plastic(0x222222)));
    this.add(new Display({ id: 'lcd', width: 320, height: 240, size: [48.96, 36.72],
                           position: [0, 0, 16.05], touch }));
    this.add(new Button({ id: 'btnA', mesh: myCapMesh, position: [0, -22, 16], axis: [0, 0, -1] }));
    this.add(new Port({ id: 'portA', connector: 'grove', position: [27, 0, 8],
                        quaternion: geometry.basisQuaternion([0,-1,0],[0,0,1],[1,0,0]) /* +Y out */ }));
  }
}
registerPlugin(definePlugin({ name: 'acme', devices: [MyBoard] }));
```

Rules:
- Model in mm in the device frame (+X right, +Y up/top, +Z towards the viewer).
- A component's local frame is its `position`/`quaternion`; meshes that should
  receive pointer events must go through `component.hit(mesh)`.
- Never call overridable methods in a constructor — put modelling in `build()`.
- Follow `BUILD.md` for the full workflow (reference photos, measurements, checks).

## Adding a module

```js
export class MyHat extends Module {
  static meta = { id: 'acme.hat.thing', name: 'Hat · Thing', connector: 'm5.hat2' };
  build() {
    // Port frame: origin at the connector face, +Y away from the host, +Z = host front.
    this.body.add(myHatMesh);
    this.add(new Button({ id: 'k', mesh: capMesh, position: [0, 10, 7] }));   // → 'hat/k'
  }
}
```

## Adding a component type

Subclass `Component`, set `static kind`, build meshes into `this.object3d`,
report with `this.input(action, payload)`, accept commands in `handle(cmd)`,
animate in `update(dt)` (return `true` while animating so the viewer keeps
rendering), and override `get interactive()` + `onPointerDown/Move/Up` to take
pointer input. `describe(intersection)` feeds hover tooltips.

## Gotchas for integrators

- Displays upload lazily: write as often as you like; the GPU copy happens at
  most once per rendered frame.
- `device.handle()` throws on an unknown target; the bridge turns that into a
  `reply` error (with `id`) or `onError` (without).
- Module components disappear on detach — watch `port` `detach` events before
  sending to `hat/...` paths.
- Audio needs a user gesture; the viewer unlocks it on the first pointer down.
- Expose nothing from `#private` fields to the simulator; use `getState()`.
