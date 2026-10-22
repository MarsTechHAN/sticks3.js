import * as THREE from 'three';
import { Module } from '../core/Module.js';
import { Display } from '../core/components/Display.js';
import { roundedSlab, decal } from '../core/geometry.js';
import { materials } from '../core/materials.js';

/**
 * Example Hat2 module: an 8×8 RGB LED matrix that plugs onto the top end of a
 * StickS3. Its matrix is a regular `Display` in `led` style, so the simulator
 * drives it exactly like the main screen:
 *
 *   device.get('hat/matrix').fill('#300') // or { type:'display', target:'hat/matrix', … }
 *
 * Built in the port frame (+Y away from the host, +Z = host front).
 */
export class HatLedMatrix extends Module {
  static meta = {
    id: 'example.hat.led-matrix-8x8',
    name: 'Hat · 8×8 RGB Matrix',
    connector: 'm5.hat2',
    description: 'Illustrative Hat2 module: 64 addressable RGB LEDs (WS2812-style).',
  };

  build({ color = 0x2b2c31 } = {}) {
    const W = 24, L = 22, T = 13.6, gap = 0.35, zc = -0.7;
    const body = new THREE.Mesh(roundedSlab({ w: W, h: L, depth: T, radius: 3.6, bevel: 0.8 }), materials.plastic(color));
    body.position.set(0, gap + L / 2, zc - T / 2);
    this.body.add(body);

    // Male header stub, visible in the seam between hat and host.
    const pins = new THREE.Mesh(new THREE.BoxGeometry(20.2, gap + 0.4, 2.6), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
    pins.position.set(0, gap / 2, -4.15);
    this.body.add(pins);

    // Matrix window: black diffuser frame + LED display.
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(19.2, 19.2), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.4 }));
    frame.position.set(0, gap + L / 2, zc + T / 2 + 0.01);
    this.body.add(frame);

    this.add(new Display({
      id: 'matrix', label: '8×8 RGB LED matrix', width: 8, height: 8, size: [17.6, 17.6], style: 'led',
      offColor: 0x2a2a2a, glass: { size: [19.2, 19.2], roughness: 0.25, intensity: 0.6 },
      position: [0, gap + L / 2, zc + T / 2 + 0.03], meta: { driver: 'WS2812C', data: 'G26 (Hat2)' },
    }));

    const side = decal(14, 3, (ctx, w, h, s) => {
      ctx.fillStyle = 'rgba(210,212,218,0.8)';
      ctx.font = `600 ${1.8 * s}px Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText('MATRIX 8×8', 0.2 * s, h / 2);
    });
    side.position.set(W / 2 + 0.02, gap + L / 2, zc);
    side.rotation.y = Math.PI / 2;
    side.rotation.z = Math.PI / 2;
    this.body.add(side);
  }
}
