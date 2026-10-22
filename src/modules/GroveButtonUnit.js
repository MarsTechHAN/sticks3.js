import * as THREE from 'three';
import { Module } from '../core/Module.js';
import { Button } from '../core/components/Button.js';
import { Led } from '../core/components/Led.js';
import { roundedSlab, decal } from '../core/geometry.js';
import { materials } from '../core/materials.js';

const WIRE_COLORS = [0x1b1b1b, 0xd8261c, 0xf2c200, 0xf0f0f0]; // GND, 5V, SIG1, SIG2

/**
 * Example Grove module: a button unit with a status LED, connected through a
 * 4-wire HY2.0 cable. Components: `btn` (Button) and `led` (Led), addressed as
 * `grove/btn` and `grove/led` from the host device.
 *
 * Built in the port frame (+Y away from the host, +Z = host front).
 */
export class GroveButtonUnit extends Module {
  static meta = {
    id: 'example.grove.button-unit',
    name: 'Unit · Button (Grove)',
    connector: 'grove',
    description: 'Illustrative Grove unit: one key on SIG1, one LED on SIG2, with cable.',
  };

  build({ cableLength = 18, capColor = 0xe2462f } = {}) {
    const white = materials.plastic(0xf1f0eb, { roughness: 0.55 });
    const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 });

    // Plug inserted into the host receptacle.
    const plug = new THREE.Mesh(new THREE.BoxGeometry(8.4, 4.2, 4.2), white);
    plug.position.y = 1.4;
    this.body.add(plug);

    // Unit body
    const S = 24, T = 9, F = T / 2; // F = front face (unit centred on the port's Z)
    const top = 3.5 + cableLength;
    const unit = new THREE.Mesh(roundedSlab({ w: S, h: S, depth: T, radius: 2.2, bevel: 0.7 }), materials.plastic(0xdcdcd8, { roughness: 0.65 }));
    unit.position.set(0, top + S / 2, -T / 2);
    this.body.add(unit);
    const unitPlug = plug.clone();
    unitPlug.position.y = top - 1.4;
    this.body.add(unitPlug);
    const receptacle = new THREE.Mesh(new THREE.BoxGeometry(9.9, 5, 5.2), white);
    receptacle.position.set(0, top + 2.4, 0);
    this.body.add(receptacle);

    // 4-wire flat cable: a gentle S-bend between the two plugs, bowing to
    // the back so it stays clear of anything plugged into a front-side port.
    const path = new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, 3.4, 0), new THREE.Vector3(0, 3.4 + cableLength * 0.45, -5.5),
      new THREE.Vector3(0, top - cableLength * 0.45, -5.5), new THREE.Vector3(0, top - 3.4, 0));
    WIRE_COLORS.forEach((color, i) => {
      const off = (i - 1.5) * 0.95;
      const pts = path.getPoints(40).map((p) => p.clone().setX(off));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.46, 8),
        materials.glossy(color, { roughness: 0.45, clearcoat: 0.2 }));
      this.body.add(tube);
    });

    // Front: big round key + LED + print.
    const cy = top + S / 2 + 1.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.55, 12, 48), black);
    ring.position.set(0, cy, F + 0.05);
    this.body.add(ring);
    const capGeo = new THREE.CylinderGeometry(5.8, 5.9, 2.2, 48).rotateX(Math.PI / 2);
    capGeo.translate(0, 0, 0.5);
    this.add(new Button({
      id: 'btn', label: 'Unit key', mesh: new THREE.Mesh(capGeo, materials.glossy(capColor, { roughness: 0.35 })),
      position: [0, cy, F], travel: 0.6, meta: { signal: 'SIG1 (G9 on StickS3)' },
    }));
    this.add(new Led({
      id: 'led', label: 'Unit LED', color: 0x33ff66, radius: 0.8, glowSize: 6,
      position: [8.5, top + 3.6, F + 0.05], meta: { signal: 'SIG2 (G10 on StickS3)' },
    }));
    const print = decal(12, 3, (ctx, w, h, s) => {
      ctx.fillStyle = '#5a5a5a';
      ctx.font = `700 ${1.9 * s}px Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText('BUTTON', 0, h / 2);
    });
    // The port frame is upside-down relative to the host on a bottom-end port:
    // turn the print so it reads upright when the host is held upright.
    print.position.set(4.6, top + S - 2.6, F + 0.03);
    print.rotation.z = Math.PI;
    this.body.add(print);
  }
}
