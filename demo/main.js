import {
  DeviceViewer, createBridge, registerPlugin, listModules,
  StickS3, sticks3Plugin, examplesPlugin,
} from '../src/index.js';

registerPlugin(sticks3Plugin);
registerPlugin(examplesPlugin);

// ── 1. Viewer + device ───────────────────────────────────────────────
const stage = document.getElementById('stage');
const viewer = new DeviceViewer(stage);
const device = viewer.mount(new StickS3());
viewer.setView('iso', { duration: 0 });
setTimeout(() => viewer.setView('front', { duration: 900 }), 350);

// ── 2. Simulator bridge (firmware lives in a Web Worker) ─────────────
const worker = new Worker(new URL('./firmware.worker.js', import.meta.url), { type: 'module' });
const bridge = createBridge(device, { send: (msg) => worker.postMessage(msg), imuRate: 30 });
worker.onmessage = (e) => bridge.receive(e.data);
const config = (patch) => worker.postMessage({ type: 'config', ...patch });

// ── 3. Panel: spec sheet ─────────────────────────────────────────────
const meta = StickS3.meta;
const spec = {
  Model: `${meta.name} · ${meta.sku}`,
  MCU: meta.mcu,
  Size: `${meta.size.join(' × ')} mm`,
  LCD: '1.14" IPS 135×240 · ST7789P3',
  IMU: 'BMI270 · X→USB Y→right Z→out',
  Ports: 'Hat2 2×8 · Grove HY2.0-4P · USB-C',
};
document.getElementById('spec').innerHTML = Object.entries(spec).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

// ── 4. Views ─────────────────────────────────────────────────────────
const views = document.getElementById('views');
views.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.view) viewer.setView(b.dataset.view);
  else if (b.dataset.action === 'inspect') { viewer.setView('front'); viewer.focus('lcd', { distance: 60 }); }
  else if (b.dataset.action === 'reset') viewer.resetView();
  for (const x of views.querySelectorAll('button')) x.classList.toggle('on', x === b && !!b.dataset.view);
});

// ── 5. Display controls ──────────────────────────────────────────────
const lcd = device.display('lcd');
const $ = (id) => document.getElementById(id);
$('backlight').oninput = (e) => lcd.setBacklight(+e.target.value);
$('style').onchange = (e) => lcd.setStyle(e.target.value);
$('pixelEffect').onchange = (e) => lcd.setPixelEffect(e.target.checked);
$('touch').onchange = (e) => { lcd.setTouchEnabled(e.target.checked); config({ touch: e.target.checked }); };

// ── 6. Feedback ──────────────────────────────────────────────────────
$('vibShort').onclick = () => device.vibrate(200);
$('vibPattern').onclick = () => device.vibrate([120, 80, 120, 80, 300], { intensity: 0.8 });
$('beep').onclick = () => device.speaker().tone(1760, 120);
$('sound').onchange = (e) => { device.speaker().enabled = e.target.checked; };

// ── 7. Ports: one selector per port, listing registered modules that fit ──
const portsEl = $('ports');
const portSelects = new Map();
for (const port of device.list('port')) {
  const row = document.createElement('label');
  row.className = 'row';
  row.textContent = port.label.replace(/\s*\(.*\)/, '');
  const sel = document.createElement('select');
  sel.innerHTML = '<option value="">— empty —</option>' +
    listModules({ connector: port.connector }).map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
  sel.onchange = () => {
    if (sel.value) port.attach(sel.value);
    else port.detach();
    viewer.fit({ duration: 400 });
  };
  sel.onfocus = () => port.setHighlight(true);
  sel.onblur = () => port.setHighlight(false);
  row.append(sel);
  portsEl.append(row);
  portSelects.set(port.path, sel);
}
device.on('module:attach', ({ port, module }) => { portSelects.get(port.path).value = module.meta.id; });
device.on('module:detach', ({ port }) => { portSelects.get(port.path).value = ''; });

// ── 8. Hover tooltip ─────────────────────────────────────────────────
const tooltip = $('tooltip');
let mouse = { x: 0, y: 0 };
stage.addEventListener('pointermove', (e) => {
  const r = stage.getBoundingClientRect();
  mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  tooltip.style.left = `${Math.min(mouse.x + 16, r.width - 290)}px`;
  tooltip.style.top = `${mouse.y + 18}px`;
});
viewer.on('hover', (info) => {
  if (!info) { tooltip.hidden = true; return; }
  const metaText = Object.entries(info.meta ?? {}).map(([k, v]) => `${k}: ${v}`).join('<br>');
  const extra = info.pixel ? `<div class="pin">pixel ${info.pixel.x}, ${info.pixel.y}</div>`
    : info.pin ? `<div class="pin">pin ${info.pin.n} · ${info.pin.name}</div>` : '';
  const hint = info.kind === 'port' ? (info.module ? `<div class="meta">${info.module} attached</div>` : '<div class="meta">click to attach a module</div>') : '';
  tooltip.innerHTML = `<div class="kind">${info.kind} · ${info.path}</div><b>${info.label}</b>${extra}${hint}${metaText ? `<div class="meta">${metaText}</div>` : ''}`;
  tooltip.hidden = false;
});
viewer.on('select', (info) => {
  if (info.kind !== 'port') return;
  // Click on a port: plug in the first compatible module, click again to unplug.
  const sel = portSelects.get(info.path);
  if (!sel) return;
  sel.value = info.component.module ? '' : sel.options[1]?.value ?? '';
  sel.onchange();
});

// ── 9. IMU readout ───────────────────────────────────────────────────
const imu = device.imu();
const imuEl = $('imu');
const AX = [['ax', 'accel', 'x', '#ff6b6b', 1], ['ay', 'accel', 'y', '#4cd964', 1], ['az', 'accel', 'z', '#4da3ff', 1],
  ['gx', 'gyro', 'x', '#ff6b6b', 360], ['gy', 'gyro', 'y', '#4cd964', 360], ['gz', 'gyro', 'z', '#4da3ff', 360]];
imuEl.innerHTML = AX.map(([n, , , c]) => `<span>${n}</span><div class="bar" style="--c:${c}"><i id="b-${n}"></i></div><output id="o-${n}"></output>`).join('');
setInterval(() => {
  const r = imu.read();
  for (const [n, group, axis, , scale] of AX) {
    const v = r[group][axis];
    const k = Math.max(-1, Math.min(1, v / scale));
    const bar = $(`b-${n}`);
    bar.style.left = k < 0 ? `${50 + k * 50}%` : '50%';
    bar.style.width = `${Math.abs(k) * 50}%`;
    $(`o-${n}`).textContent = group === 'accel' ? v.toFixed(2) : Math.round(v);
  }
}, 100);

// ── 10. Input event log ──────────────────────────────────────────────
const log = $('log');
const COLORS = { button: '#7cc4ff', display: '#ffd23f', port: '#4cd964' };
const t0 = performance.now();
device.on('input', (e) => {
  if (e.kind === 'display' && e.action === 'move') return; // keep the log readable
  const li = document.createElement('li');
  const detail = e.kind === 'display' ? `${e.x},${e.y}` : e.module ?? (e.duration ? `${Math.round(e.duration)}ms` : '');
  li.innerHTML = `<time>${((e.time - t0) / 1000).toFixed(2)}</time><span><b style="--k:${COLORS[e.kind] ?? '#fff'}">${e.id}</b> ${e.action} <small>${detail}</small></span>`;
  log.prepend(li);
  while (log.children.length > 120) log.lastChild.remove();
});
$('clearLog').onclick = () => { log.innerHTML = ''; };

// ── 11. Frame counter (renders are on demand) ────────────────────────
let frames = 0;
viewer.on('render', () => frames++);
setInterval(() => { $('fps').textContent = `${frames} renders/s`; frames = 0; }, 1000);

// Expose for poking around in DevTools.
Object.assign(window, { viewer, device, bridge });
