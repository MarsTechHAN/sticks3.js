import * as THREE from 'three';
import { Module } from '../core/Module.js';
import { roundedSlab, capsule } from '../core/geometry.js';
import { materials } from '../core/materials.js';

/**
 * USB-C cable accessory. Plugging it into a `usb-c` port emits
 * `{ kind:'port', id:'usb', action:'attach', module:'example.usb-c-cable' }`,
 * which a simulator can treat as "VBUS present" (charging, serial attached…).
 * Pass `{ power: false }` for a data-only cable (stored on `module.power`).
 *
 * Built in the port frame (+Y away from the host, +Z = host front). The cable
 * swings to the side so it stays clear of other modules on the same end.
 */
export class UsbCCable extends Module {
  static meta = {
    id: 'example.usb-c-cable',
    name: 'USB-C cable',
    connector: 'usb-c',
    description: 'USB-C plug with a short length of cable. Signals VBUS / host connection.',
  };

  build({ color = 0xeeeeec, power = true } = {}) {
    this.power = power;
    const shell = materials.plastic(color, { roughness: 0.5, clearcoat: 0.3 });
    const metal = materials.metal(0xa9adb3, { roughness: 0.32 });

    // Metal plug: only its last millimetre is visible at the receptacle mouth.
    const plug = new THREE.ExtrudeGeometry(capsule(8.25, 2.4), { depth: 1.0, bevelEnabled: false, curveSegments: 12 });
    plug.rotateX(-Math.PI / 2);
    this.body.add(new THREE.Mesh(plug, metal));

    // Overmold
    const mold = roundedSlab({ w: 11.5, h: 5.6, depth: 12, radius: 2.6, bevel: 1.0 });
    mold.rotateX(-Math.PI / 2);
    mold.translate(0, 0.9, 0);
    this.body.add(new THREE.Mesh(mold, shell));

    // Strain relief
    const relief = new THREE.CylinderGeometry(1.75, 2.3, 6, 24);
    relief.translate(0, 15.8, 0);
    this.body.add(new THREE.Mesh(relief, shell));

    // Cable: bends to one side right away, then hangs down — keeping clear of
    // anything else hanging off the same end (e.g. a Grove unit).
    const curve = new THREE.CatmullRomCurve3([
      [0, 18.5, 0], [-3, 21, 2], [-11, 23, 3.5], [-16.5, 27, 3.5], [-18.5, 36, 2.5], [-19, 50, 1.5], [-19.5, 64, 1],
    ].map((p) => new THREE.Vector3(...p)));
    this.body.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 1.6, 14), shell));
  }
}
