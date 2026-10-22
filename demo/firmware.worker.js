/*
 * Toy "firmware" for the demo, running in a Web Worker.
 *
 * It stands in for a real hardware simulator: it never touches three.js, only
 * exchanges plain messages with the page through `createBridge()`:
 *   ← { type:'input', kind, id, action, … }   button / touch / port events
 *   ← { type:'imu', accel, gyro }              periodic IMU samples
 *   → { type:'display', target:'lcd', format:'rgb565', … , data }  framebuffer
 *   → { type:'vibrate' | 'tone' | 'led' | … }
 *
 * BtnB = next app, BtnA = action, Power: double-click = off, click = on.
 * Plugging the USB-C cable starts "charging" (and powers the device on).
 */
const W = 135, H = 240;
const canvas = new OffscreenCanvas(W, H);
const g = canvas.getContext('2d', { willReadFrequently: true });
const ACCENT = '#1f8dff';

const state = {
  app: 0,
  power: true,
  boot: false,
  imu: { accel: { x: -1, y: 0, z: 0 }, gyro: { x: 0, y: 0, z: 0 } },
  touchEnabled: false,
  strokes: [],
  live: new Map(),
  hat: null,
  grove: null,
  usb: false,
  battery: 0.62,
  unitPresses: 0,
  unitLed: false,
  matrixMode: 0,
  rings: [],
  lastPwrClick: 0,
  t0: performance.now(),
  frame: 0,
};

const send = (cmd, transfer) => postMessage(cmd, transfer ?? []);

// ─────────────────────────── apps ───────────────────────────

const apps = [
  { name: 'Home', draw: drawHome },
  { name: 'Level', draw: drawLevel },
  { name: 'Touch', draw: drawPaint, action: () => { state.strokes = []; } },
  { name: 'Pixels', draw: drawPixels },
  { name: 'Haptics', draw: drawBuzz, action: buzz },
  { name: 'Modules', draw: drawModules, action: () => { state.matrixMode = (state.matrixMode + 1) % 3; } },
];

function header(title) {
  g.fillStyle = '#0b0f17';
  g.fillRect(0, 0, W, 18);
  g.fillStyle = '#e8eef8';
  g.font = '600 11px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText(title, 6, 9.5);
  // battery
  g.strokeStyle = '#9fb3c8';
  g.lineWidth = 1;
  g.strokeRect(W - 22.5, 5.5, 15, 8);
  g.fillStyle = '#9fb3c8';
  g.fillRect(W - 7, 8, 2, 3);
  g.fillStyle = state.battery < 0.2 ? '#ff5a4f' : '#4cd964';
  g.fillRect(W - 21, 7, Math.max(1, Math.round(12 * state.battery)), 5);
  if (state.usb) {
    // charging bolt
    g.fillStyle = '#ffd23f';
    g.beginPath();
    g.moveTo(W - 31, 4); g.lineTo(W - 35, 10); g.lineTo(W - 32, 10); g.lineTo(W - 34, 15); g.lineTo(W - 29, 8); g.lineTo(W - 32, 8);
    g.closePath(); g.fill();
  }
  // page dots
  for (let i = 0; i < apps.length; i++) {
    g.fillStyle = i === state.app ? ACCENT : '#3a4658';
    g.fillRect(W / 2 - apps.length * 3 + i * 6 + 14, 8, 3, 3);
  }
}

function footer(text) {
  g.fillStyle = '#5c6b80';
  g.font = '9px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillText(text, W / 2, H - 6);
}

function drawHome(t) {
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0d1a2e');
  grad.addColorStop(1, '#04070c');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  header('StickS3');
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = '700 44px system-ui, sans-serif';
  g.fillText(hh, W / 2, 82);
  g.fillText(mm, W / 2, 128);
  // seconds arc
  const s = d.getSeconds() + d.getMilliseconds() / 1000;
  g.strokeStyle = '#1b2a40';
  g.lineWidth = 4;
  g.beginPath(); g.arc(W / 2, 168, 22, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = ACCENT;
  g.beginPath(); g.arc(W / 2, 168, 22, -Math.PI / 2, -Math.PI / 2 + (s / 60) * Math.PI * 2); g.stroke();
  g.fillStyle = '#cfe3ff';
  g.font = '600 13px ui-monospace, monospace';
  g.textBaseline = 'middle';
  g.fillText(String(Math.floor(s)).padStart(2, '0'), W / 2, 169);
  g.fillStyle = '#7f93ad';
  g.font = '10px system-ui, sans-serif';
  g.fillText(d.toDateString().slice(0, 10), W / 2, 204);
  footer('BtnB ▸ next app');
}

function drawLevel() {
  g.fillStyle = '#05080d';
  g.fillRect(0, 0, W, H);
  header('Level · IMU');
  const { accel: a, gyro: gy } = state.imu;
  const cx = W / 2, cy = 92, R = 52;
  g.strokeStyle = '#2b3a50';
  g.lineWidth = 1;
  for (const r of [R, R * 0.5, 6]) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
  // Bubble floats to the high side: screen-right = sensor +Y, screen-down = sensor +X.
  let bx = a.y * R, by = a.x * R;
  const len = Math.hypot(bx, by);
  if (len > R - 8) { bx *= (R - 8) / len; by *= (R - 8) / len; }
  const level = Math.hypot(a.x, a.y) < 0.05;
  g.fillStyle = level ? '#4cd964' : '#ffd23f';
  g.beginPath(); g.arc(cx + bx, cy + by, 8, 0, Math.PI * 2); g.fill();

  g.font = '10px ui-monospace, monospace';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const rows = [['ax', a.x, '#ff6b6b'], ['ay', a.y, '#4cd964'], ['az', a.z, '#4da3ff']];
  rows.forEach(([n, v, c], i) => {
    const y = 162 + i * 14;
    g.fillStyle = '#8796ab'; g.fillText(n, 6, y);
    g.fillStyle = '#1a2433'; g.fillRect(24, y - 4, 70, 8);
    g.fillStyle = c; g.fillRect(59, y - 4, Math.max(-35, Math.min(35, v * 35)), 8);
    g.fillStyle = '#dfe8f5'; g.fillText(v.toFixed(2), 98, y);
  });
  g.fillStyle = '#8796ab';
  g.fillText(`gyro ${fmt(gy.x)} ${fmt(gy.y)} ${fmt(gy.z)}`, 6, 210);
  footer(level ? 'level ✓' : 'drag the device to tilt it');
}

const fmt = (v) => (v >= 0 ? '+' : '') + Math.round(v).toString().padStart(3, ' ');

function drawPaint() {
  g.fillStyle = '#f7f5ef';
  g.fillRect(0, 0, W, H);
  header('Touch');
  if (!state.touchEnabled) {
    g.fillStyle = '#4a4a4a';
    g.font = '600 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    ['StickS3 has no touch', 'panel. Turn on', '"Touch layer" in the', 'side panel to try the', 'touch API.'].forEach((l, i) => g.fillText(l, W / 2, 90 + i * 16));
    return;
  }
  g.lineCap = g.lineJoin = 'round';
  g.lineWidth = 3;
  const strokes = [...state.strokes, ...state.live.values()];
  strokes.forEach((s, i) => {
    g.strokeStyle = `hsl(${(i * 47) % 360} 80% 45%)`;
    g.beginPath();
    s.forEach(([x, y], k) => (k ? g.lineTo(x + 0.5, y + 0.5) : g.moveTo(x + 0.5, y + 0.5)));
    if (s.length === 1) g.lineTo(s[0][0] + 0.6, s[0][1] + 0.6);
    g.stroke();
  });
  for (const s of state.live.values()) {
    const [x, y] = s[s.length - 1];
    g.fillStyle = '#d33';
    g.font = '9px ui-monospace, monospace';
    g.textAlign = 'left';
    g.fillText(`${x},${y}`, Math.min(W - 40, x + 6), Math.max(26, y - 6));
  }
  footer('draw on the screen · BtnA clears');
  g.fillStyle = '#999';
}

function drawPixels() {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  header('Pixels');
  const bars = ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f', '#000'];
  const bw = W / bars.length;
  bars.forEach((c, i) => { g.fillStyle = c; g.fillRect(Math.round(i * bw), 20, Math.ceil(bw), 40); });
  const ramps = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
  ramps.forEach(([r, gg, b], k) => {
    for (let x = 0; x < W; x++) {
      const v = x / (W - 1);
      g.fillStyle = `rgb(${r * v},${gg * v},${b * v})`;
      g.fillRect(x, 64 + k * 12, 1, 10);
    }
  });
  // 1-px checkerboard and single-pixel lines: zoom in to see sub-pixels.
  const img = g.getImageData(0, 0, W, H);
  for (let y = 116; y < 156; y++) {
    for (let x = 4; x < 64; x++) {
      const on = (x + y) % 2 === 0, o = (y * W + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = on ? 255 : 0;
    }
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = ['#fff', '#f00', '#0f0', '#00f', '#ff0', '#0ff'][i];
    g.fillRect(72 + i * 10, 116, 1, 40);
  }
  g.fillStyle = '#fff';
  g.font = '8px ui-monospace, monospace';
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText('135x240 ST7789P3', 4, 164);
  g.fillText('RGB565 framebuffer', 4, 176);
  g.fillStyle = '#ffd23f';
  g.font = '6px ui-monospace, monospace';
  g.fillText('tiny 6px text', 4, 190);
  footer('zoom in (wheel) to see sub-pixels');
}

function buzz() {
  send({ type: 'vibrate', pattern: [70, 50, 70, 50, 140], intensity: 1 });
  send({ type: 'tone', target: 'speaker', frequency: 1760, duration: 70 });
  state.rings.push(performance.now());
}

function drawBuzz(t) {
  g.fillStyle = '#0a0710';
  g.fillRect(0, 0, W, H);
  header('Haptics');
  const cx = W / 2, cy = 112;
  const now = performance.now();
  state.rings = state.rings.filter((r) => now - r < 900);
  for (const r of state.rings) {
    const k = (now - r) / 900;
    g.strokeStyle = `rgba(255,120,80,${1 - k})`;
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 24 + k * 50, 0, Math.PI * 2); g.stroke();
  }
  g.fillStyle = state.rings.length ? '#ff7a50' : '#3a2533';
  g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  g.font = '700 12px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('BUZZ', cx, cy + 1);
  footer('BtnA ▸ vibrate + beep');
}

function drawModules(t) {
  g.fillStyle = '#060a0f';
  g.fillRect(0, 0, W, H);
  header('Modules');
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const row = (y, title, value, ok) => {
    g.fillStyle = '#7f93ad'; g.font = '9px system-ui, sans-serif'; g.fillText(title, 8, y);
    g.fillStyle = ok ? '#e6f0ff' : '#4a5668'; g.font = '600 11px system-ui, sans-serif'; g.fillText(value, 8, y + 14);
  };
  row(34, 'HAT2 · top', state.hat ?? '— empty —', !!state.hat);
  row(74, 'GROVE · PORT.A', state.grove ?? '— empty —', !!state.grove);
  g.fillStyle = state.usb ? '#ffd23f' : '#4a5668';
  g.font = '9px system-ui, sans-serif';
  g.fillText(state.usb ? `USB 5V · charging ${Math.round(state.battery * 100)}%` : `USB unplugged · ${Math.round(state.battery * 100)}%`, 8, 104);
  if (state.hat) {
    const px = matrixPixels(t);
    for (let i = 0; i < 64; i++) {
      g.fillStyle = `rgb(${px[i * 3]},${px[i * 3 + 1]},${px[i * 3 + 2]})`;
      g.fillRect(8 + (i % 8) * 7, 120 + Math.floor(i / 8) * 7, 6, 6);
    }
    g.fillStyle = '#7f93ad'; g.font = '9px system-ui, sans-serif';
    g.fillText(['rainbow', 'heart', 'scanner'][state.matrixMode], 70, 146);
  }
  if (state.grove) {
    g.fillStyle = '#7f93ad'; g.font = '9px system-ui, sans-serif';
    g.fillText('unit key presses', 8, 192);
    g.fillStyle = state.unitLed ? '#4cd964' : '#e6f0ff';
    g.font = '700 20px system-ui, sans-serif';
    g.fillText(String(state.unitPresses), 8, 210);
  }
  footer(state.hat ? 'BtnA ▸ matrix pattern' : 'attach modules in panel');
}

// ─────────────────────────── hat matrix ───────────────────────────

const HEART = [
  '........', '.##..##.', '########', '########', '.######.', '..####..', '...##...', '........',
];

function hsv(h, s, v) {
  const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

function matrixPixels(t) {
  const px = new Uint8Array(64 * 3);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let c = [0, 0, 0];
      if (state.matrixMode === 0) c = hsv((x + y) / 16 + t * 0.15, 1, 0.9);
      else if (state.matrixMode === 1) {
        const beat = 0.55 + 0.45 * Math.abs(Math.sin(t * 3));
        if (HEART[y][x] === '#') c = [255 * beat, 30 * beat, 60 * beat];
      } else {
        const pos = (Math.sin(t * 2.5) * 0.5 + 0.5) * 7;
        const d = Math.abs(x - pos);
        c = [255 * Math.max(0, 1 - d / 1.5), 40 * Math.max(0, 1 - d / 3), 0];
      }
      px.set(c.map((v) => Math.round(v)), (y * 8 + x) * 3);
    }
  }
  return px;
}

// ─────────────────────────── system screens ───────────────────────────

function drawBoot() {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#4cd964';
  g.font = '600 11px ui-monospace, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('DOWNLOAD MODE', W / 2, H / 2 - 8);
  g.fillStyle = '#6b7a8c';
  g.font = '9px ui-monospace, monospace';
  g.fillText('waiting for esptool…', W / 2, H / 2 + 10);
  g.fillText('press Power to exit', W / 2, H / 2 + 24);
}

// ─────────────────────────── framebuffer ───────────────────────────

function flush() {
  const src = g.getImageData(0, 0, W, H).data;
  const fb = new Uint16Array(W * H);
  for (let i = 0, o = 0; i < fb.length; i++, o += 4) {
    fb[i] = ((src[o] >> 3) << 11) | ((src[o + 1] >> 2) << 5) | (src[o + 2] >> 3);
  }
  send({ type: 'display', target: 'lcd', format: 'rgb565', x: 0, y: 0, w: W, h: H, data: fb }, [fb.buffer]);
}

function tick() {
  // Battery model: charges on USB, slowly drains otherwise.
  state.battery = Math.max(0.05, Math.min(1, state.battery + (state.usb ? 0.0006 : -0.00002)));
  if (!state.power) return;
  const t = (performance.now() - state.t0) / 1000;
  if (state.boot) drawBoot();
  else apps[state.app].draw(t);
  flush();
  if (state.hat && !state.boot) {
    send({ type: 'display', target: 'hat/matrix', format: 'rgb888', x: 0, y: 0, w: 8, h: 8, data: matrixPixels(t) });
  }
  state.frame++;
}

function setPower(on) {
  state.power = on;
  state.boot = false;
  send({ type: 'display', target: 'lcd', power: on });
  if (state.hat) send({ type: 'display', target: 'hat/matrix', power: on });
  if (on) send({ type: 'vibrate', pattern: 60, intensity: 0.6 });
}

// ─────────────────────────── input ───────────────────────────

function onInput(e) {
  if (e.kind === 'button') {
    if (e.id === 'btnPWR') {
      if (e.action === 'longpress') { state.boot = true; state.power = true; send({ type: 'display', target: 'lcd', power: true }); return; }
      if (e.action !== 'click') return;
      const now = performance.now();
      if (!state.power || state.boot) return setPower(true);
      if (now - state.lastPwrClick < 450) { state.lastPwrClick = 0; return setPower(false); }
      state.lastPwrClick = now;
      return;
    }
    if (!state.power || state.boot) return;
    if (e.id === 'btnB' && e.action === 'click') {
      state.app = (state.app + 1) % apps.length;
      send({ type: 'tone', target: 'speaker', frequency: 2400, duration: 25, volume: 0.3 });
    }
    if (e.id === 'btnA' && e.action === 'click') apps[state.app].action?.();
    if (e.id === 'btnA' && e.action === 'longpress') state.app = (state.app + apps.length - 1) % apps.length;
    if (e.id === 'grove/btn' && e.action === 'down') {
      state.unitPresses++;
      state.unitLed = !state.unitLed;
      send({ type: 'led', target: 'grove/led', on: state.unitLed });
      send({ type: 'tone', target: 'speaker', frequency: 1200, duration: 40, volume: 0.3 });
    }
  } else if (e.kind === 'display' && e.id === 'lcd') {
    if (e.action === 'start') state.live.set(e.pointerId, [[e.x, e.y]]);
    else if (e.action === 'move') state.live.get(e.pointerId)?.push([e.x, e.y]);
    else if (e.action === 'end') {
      const s = state.live.get(e.pointerId);
      if (s) state.strokes.push(s);
      state.live.delete(e.pointerId);
    }
  } else if (e.kind === 'port') {
    const name = e.action === 'attach' ? e.name : null;
    if (e.id === 'hat') state.hat = name;
    if (e.id === 'grove') { state.grove = name; state.unitLed = false; }
    if (e.id === 'usb') {
      state.usb = e.action === 'attach';
      send({ type: 'tone', target: 'speaker', frequency: state.usb ? 1320 : 880, duration: 60, volume: 0.3 });
      if (state.usb && !state.power) setPower(true); // M5PM1 powers on when VBUS appears
    }
    if (e.action === 'attach' && e.id === 'hat' && !state.power) send({ type: 'display', target: 'hat/matrix', power: false });
  }
}

self.onmessage = ({ data: m }) => {
  if (m.type === 'input') onInput(m);
  else if (m.type === 'imu') state.imu = m;
  else if (m.type === 'config') {
    if ('touch' in m) state.touchEnabled = m.touch;
    if ('hat' in m) state.hat = m.hat;
    if ('grove' in m) state.grove = m.grove;
  } else if (m.type === 'reply' && m.error) console.warn('[firmware] command failed:', m.error);
};

setInterval(tick, 1000 / 30);
