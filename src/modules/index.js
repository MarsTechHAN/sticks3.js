import { definePlugin } from '../core/registry.js';
import { HatLedMatrix } from './HatLedMatrix.js';
import { GroveButtonUnit } from './GroveButtonUnit.js';
import { UsbCCable } from './UsbCCable.js';

export { HatLedMatrix, GroveButtonUnit, UsbCCable };

/** Example expansion modules and accessories. `registerPlugin(examplesPlugin)` to create them by id. */
export const examplesPlugin = definePlugin({
  name: 'examples',
  modules: [HatLedMatrix, GroveButtonUnit, UsbCCable],
});
