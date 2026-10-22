# BUILD.md — how this was built, and how to build the next product

This file records how the StickS3 view was produced, the problems hit on the
way, and a checklist for modelling another device or module with the same
engine. Read `AGENTS.md` for the API.

## 1. Toolchain

| tool | version used | role |
|---|---|---|
| Node | 26 | scripts |
| three | 0.186.1 | rendering (peer dep, ≥ 0.160 works for the APIs used) |
| vite | 8.3 | dev server / static build of `demo/` only — the library itself needs no build |
| playwright | 1.64 | `scripts/snapshot.mjs`, driving the installed Google Chrome |

```bash
npm install
npm run dev                                      # http://localhost:5173
npm run check                                    # logic tests, no browser
node scripts/snapshot.mjs http://localhost:5173/ snapshots
```

`snapshot.mjs` runs Chrome headless with SwiftShader (software WebGL). It is
slow (≈2–15 renders/s), so waits are generous; don't read performance from it.
Set `CHANNEL=` (empty) to use Playwright's bundled Chromium after
`npx playwright install chromium`.

## 2. Reference gathering (StickS3)

Sources:
- Official docs: https://docs.m5stack.com/en/core/StickS3 (pinout tables,
  48.0 × 24.0 × 15.0 mm, peripherals, IMU axis figure).
- Product photography from the same page (`m5stack-doc.oss-cn-shenzhen.aliyuncs.com/1207/K150-stickS3_main-products_NN.webp`),
  converted with `sips -s format png`. Kept in `reference/sticks3/`:
  `overview-annotated.png` (callouts: HAT2 port, IR TX/RX, SPK, KEY1/KEY2,
  power, MIC, HY2.0-4P, USB-C), `front-iso.png`, `back-iso.png`,
  `back-label.png` (straight-on pinout sticker), `top-end.png`,
  `bottom-end-back.png`, `imu-axes.jpg`.
- Panel: 1.14" ST7789P3, 135 × 240, pixel pitch ≈ 0.1101 mm → active area
  14.86 × 26.42 mm.

Facts derived from the photos (not stated in text):
- KEY1 = blue pill below the screen; KEY2 = large square key on the **right**
  side; power = small key on the **left** side near the USB end.
- Top end: Hat2 2×8 female header on the **back half**; above it (front half)
  IR-TX (clear dome, toward +X), three speaker slots, IR-RX (black window, −X).
- Bottom end: USB-C in the front half; Grove housing on the back half,
  protruding slightly and visible from the back.
- Two-part shell: front ≈ 8.3 mm, rear ≈ 6.7 mm, seam just behind the middle.
- "STICK" + blue "S3" printed on the left side; pinout sticker on the back
  with brass inserts and screws below it.
- IMU axes (from `imu-axes.jpg`): X → USB end, Y → right side, Z → out of screen.

Mapping image directions to the model needs care: in a photo taken from the
top end with the screen up, image-left is the device's **+X** (right) side; in
a straight back view, image-left is also **+X**. Work it out with a cross
product each time rather than by eye.

## 3. Model breakdown

Frame: origin at the body centre, +X right, +Y top end, +Z front. All
dimensions live in `DIM` at the top of `src/devices/sticks3/StickS3.js`.

| part | technique |
|---|---|
| shells | `roundedSlab()` = `ExtrudeGeometry` of a rounded rect with a bevel; the front shell has the screen window and KEY1 slot as `holes` |
| seam | rear shell extends 1.2 mm *into* the front shell so its own bevel is hidden; only the front's 0.6 mm bevel shows as a thin groove |
| screen | black bezel plane + `Display` (shader) + additive "cover glass" plane |
| keys | `roundedSlab` caps translated so they protrude 0.5 mm; `Button` animates along `axis` |
| side / back artwork | 2D canvas painted at 24–30 px/mm (`labels.js`) on decal planes with `polygonOffset` |
| connectors | header and Grove = `BoxGeometry` with a painted face material (group index 2 = +Y, 3 = −Y); USB-C = extruded capsule ring + dark cavity + tongue |
| side-face parts | `FACE.top/bottom/left/right/back` quaternions (from `basisQuaternion`) so a part's local +Z is the outward normal |

`ExtrudeGeometry` bevel semantics (important): the shape you pass is the
**face** outline; the bevel grows the *sides* outward by `bevelSize`, and for
holes it grows *inward* — a hole is exactly its specified size at the face and
narrower by `bevelSize` inside. `roundedSlab()` compensates for the outer
outline so the overall footprint is exact.

## 4. Display rendering

- Framebuffer: `Uint8Array` RGBA, shared with a `DataTexture`
  (`SRGBColorSpace`, `NearestFilter`, no mipmaps). Writes only mark it dirty;
  upload happens in `update()` at most once per rendered frame.
- Shader (`Display.js`): sample at the texel centre, then multiply by a
  procedural mask. Level of detail from `fwidth(pixelCoord)`:
  - texel ≥ 2–4 screen px → black-matrix grid only (luminance, no colour)
  - texel ≥ 5–10 screen px → R/G/B vertical stripes
  - smaller → flat pixels.
  A single stripe level caused rainbow moiré at mid zoom (stripes ~1.3 screen
  px wide) — the two-level LOD fixed it.
- Styles: `lcd` (stripes), `oled` (square emitters), `led` (round dots with
  halo, for matrices), `flat`. `blackLevel` emulates IPS backlight bleed.
- `toneMapped: false` on the panel so firmware colours are not tone-mapped.
- Cover glass: `MeshPhysicalMaterial` black + `AdditiveBlending`, so it only
  adds reflections. `specularIntensity` (exposed as `glass.intensity`) must be
  low (~0.3): the key light's highlight otherwise washes out close-ups.

## 5. Engine design decisions

- Device and Module share `ComponentHost`; `build()` runs lazily on first
  access (`root`, `get()`), because a base constructor runs before subclass
  class fields are initialised.
- Paths (`hat/matrix`) route through `Port.module`, so module components are
  addressable without registration.
- The camera is fixed; dragging rotates the device root. That makes the IMU
  meaningful and keeps lighting studio-stable.
- Render on demand: `requestRender()` + components returning `true` from
  `update()` while animating.
- Module plain geometry is tagged with its port (`root.userData.component =
  port`), so hovering/clicking a plugged module reports the port.
- Simulator I/O is plain data (`input` events, `handle(cmd)`), so it can cross
  Worker/WebSocket boundaries; the demo firmware runs in a Worker and sends
  RGB565 frames as transferables.

## 6. Problems hit (and fixes)

| symptom | cause | fix |
|---|---|---|
| `device.port is not a function` | a `port` instance field shadowed the `port()` accessor | field renamed to `attachedTo` — never reuse accessor names for fields |
| hidden objects still picked | `Raycaster` ignores `visible` | viewer filters hits by effective visibility; overlays (glass, glow sprites, touch markers) get `raycast = () => {}` |
| warning: `PCFSoftShadowMap has been removed` | three r18x | use `PCFShadowMap` + `shadow.radius` |
| front face looked light grey head-on | RoomEnvironment reflection + clearcoat | darker case colour, no clearcoat, `environmentIntensity` 0.7 |
| wide dark groove at the shell seam | both shells bevelled at the seam | rear shell overlaps into the front shell (see §3) |
| rainbow moiré on zoom | sub-pixel stripes narrower than a screen pixel | two-level mask LOD (see §4) |
| `OscillatorType 'tone'` warning | the command object was passed as tone options | pass explicit `{ wave, volume }` |
| vite 500 "Failed to resolve import" after creating a file | vite cached the failed resolve | restart the dev server |
| GLSL compile issues | `dot` used as a variable name shadows the builtin | rename |
| cables crossing other modules | modules on the same end share space | Grove cable bows to the back; USB cable swings to the side |
| `git push` denied | default SSH key is a different GitHub account | per-repo `core.sshCommand` pointing at the right key |

## 7. Verification

1. `npm run check` — routing, RGB565 conversion, button sources, ports,
   bridge replies, IMU orientation, vibration pattern.
2. `node scripts/snapshot.mjs …` — screenshots of 7 views, modules, pixel
   inspection; then real pointer/keyboard input: click KEY1, press `B`, touch
   drag on the LCD, drag-rotate (asserts the IMU reading changed), vibration.
   Look at the PNGs side by side with `reference/`.
3. Manual pass in a real browser (GPU): smoothness, inertia, sound.

## 8. Checklist for a new device

1. Make `reference/<device>/` and save the product photos, pinout and the
   official dimension table there. Note the source URLs in this file.
2. Write down: overall size, corner radius, shell split, every button/port/LED
   position and size, display active area (resolution × pixel pitch), sensor
   axes. Derive positions from straight-on photos scaled by the known size.
3. Create `src/devices/<name>/` with a `DIM` table, `labels.js` for artwork,
   and a `Device` subclass whose `build()` uses `roundedSlab`, `decal`,
   `FACE`-style quaternions and the core components.
4. Give components hardware `meta` (GPIO, chip, notes) — it shows in hover
   tooltips and documents the model.
5. Export a `definePlugin({ name, devices })`, add it to `src/index.js` only if
   it should ship by default.
6. Add a `keymap` for the physical buttons.
7. Extend `scripts/snapshot.mjs` (or copy it) and compare against reference
   photos from the same angles. Iterate on materials last.
8. Add a section to this file with sources, derived facts and any new gotchas.

For a module: same steps, but model in the **port frame** (origin at the
connector face, +Y out of the host, +Z host front) and set `meta.connector`.
If it hangs off the same end as other modules, route cables so they don't
cross the others.
