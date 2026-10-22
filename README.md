# sticks3.js

Pluggable, interactive three.js hardware views — ships with a true-to-size
**M5Stack StickS3** model. It is the visual front-end for a hardware simulator:
rotate the device, press its buttons, touch its screen, plug Hat/Grove modules
and a USB-C cable, and feed its display from your firmware simulation.

- Pixel-accurate displays (RGB565/RGBA/RGB888) with an LCD sub-pixel shader
  that fades with zoom (no moiré, one texture fetch per fragment)
- Buttons (pointer, keyboard, simulator-driven), touch surfaces, LEDs,
  speaker (WebAudio), vibration, IMU derived from the on-screen orientation
- Expansion ports with connector types and pluggable modules
- Plain-data bridge for simulators in a Worker, iframe or WebSocket

```bash
npm install && npm run dev     # demo → http://localhost:5173
```

```js
import { DeviceViewer, StickS3 } from 'sticks3.js';
const device = new DeviceViewer(el).mount(new StickS3());
device.on('input', console.log);
device.display('lcd').writeRGB565(frame);
```

- **[AGENTS.md](AGENTS.md)** — API, protocol, StickS3 component map, extending
- **[BUILD.md](BUILD.md)** — how the model was built, gotchas, new-device checklist
